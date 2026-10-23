"""
Localized Pluggable LLM Adapter (`speakerid.llm`).

Purpose (BoM):
    Isolates all Large Language Model dependencies behind a clean, extensible
    interface (`LLMProvider`). Allows users to seamlessly substitute any local
    LLM (Ollama, vLLM, LM Studio, llama.cpp server) or remote LLM (Google Gemini,
    OpenAI, Anthropic, Groq, OpenRouter, or LiteLLM) without touching the rest
    of the `speakerid` codebase.

Dual-Use Architecture & Extension Guide (Human & LLM):
    - Configuration Schema (`LLMConfig`):
        * `provider` (str): One of `"openai"` (covers OpenAI, vLLM, LM Studio, llama.cpp),
          `"ollama"`, `"gemini"`, `"anthropic"`, or `"litellm"`.
        * `model` (str): Model identifier (e.g., `"llama3.3"`, `"qwen2.5:32b"`,
          `"gemini-2.5-flash"`, `"gpt-4o"`, `"claude-3-5-sonnet-latest"`).
        * `base_url` (Optional[str]): Endpoint URL for local/custom servers
          (e.g., `"http://localhost:11434/v1"` for Ollama, `"http://localhost:8000/v1"` for vLLM).
        * `api_key` (Optional[str]): API key (falls back to standard env vars:
          `LLM_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`).
        * `temperature` (float): Sampling temperature (default `0.1` for structured JSON).
        * `max_tokens` (Optional[int]): Max output tokens.
        * `timeout` (float): HTTP request timeout in seconds (default `600.0` for long transcripts).
    - Custom Provider Substitution:
        Users can subclass `LLMProvider` and implement `generate_json(prompt, system_prompt)`
        and pass their instance directly to `create_smart_transcript(..., llm_provider=my_llm)`.
"""

import json
import logging
import os
import re
import urllib.request
import urllib.error
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


def _clean_api_key(val: Optional[str]) -> Optional[str]:
    """Returns `None` if an API key is empty or still set to a `.env` `DUMMY` placeholder."""
    if not val:
        return None
    stripped = val.strip()
    if not stripped or "DUMMY" in stripped.upper():
        return None
    return stripped


@dataclass
class LLMConfig:
    """Configuration parameters for initializing an LLM provider."""
    provider: str = field(default_factory=lambda: os.environ.get("LLM_PROVIDER", "gemini"))
    model: str = field(default_factory=lambda: os.environ.get("LLM_MODEL", ""))
    base_url: Optional[str] = field(default_factory=lambda: os.environ.get("LLM_BASE_URL"))
    api_key: Optional[str] = field(default_factory=lambda: _clean_api_key(os.environ.get("LLM_API_KEY")))
    temperature: float = 0.1
    max_tokens: Optional[int] = None
    timeout: float = 600.0
    extra_params: Dict[str, Any] = field(default_factory=dict)


def extract_json_from_text(text: str) -> Dict[str, Any]:
    """Extracts and parses a JSON object from raw LLM response text, stripping markdown fences."""
    if not text:
        raise ValueError("Empty response received from LLM.")

    cleaned = text.strip()
    if cleaned.startswith("```"):
        first_nl = cleaned.find("\n")
        if first_nl != -1:
            cleaned = cleaned[first_nl:].strip()
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            return json.loads(match.group(0))
        raise


class LLMProvider(ABC):
    """Abstract base class for all local and remote LLM providers."""

    @abstractmethod
    def generate_json(self, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """Sends prompt and system instructions to the LLM and returns a parsed JSON dict."""
        pass


class OpenAICompatibleProvider(LLMProvider):
    """
    Provider for OpenAI API and any OpenAI-compatible local or remote server
    (Ollama `/v1`, vLLM, LM Studio, llama.cpp server, OpenRouter, Groq, DeepSeek).
    Uses standard HTTP or the `openai` Python package if installed.
    """

    def __init__(self, config: LLMConfig):
        """Initializes the OpenAI-compatible provider with endpoint and credentials."""
        self.config = config
        self.model = config.model or "gpt-4o-mini"
        self.base_url = (config.base_url or "https://api.openai.com/v1").rstrip("/")
        self.api_key = (
            _clean_api_key(config.api_key)
            or _clean_api_key(os.environ.get("OPENAI_API_KEY"))
            or "local-no-key-required"
        )

    def generate_json(self, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """Invokes `/chat/completions` and parses the JSON output."""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.config.temperature,
            "response_format": {"type": "json_object"},
        }
        if self.config.max_tokens:
            payload["max_tokens"] = self.config.max_tokens
        payload.update(self.config.extra_params)

        url = f"{self.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        logger.info(f"Calling OpenAI-compatible LLM at {url} (model={self.model})...")
        try:
            content = self._post_json(url, payload, headers)
        except urllib.error.HTTPError as e:
            # Some local servers do not support `response_format={"type": "json_object"}`
            if e.code == 400 and "response_format" in payload:
                logger.warning("Server rejected response_format; retrying without response_format...")
                payload.pop("response_format", None)
                content = self._post_json(url, payload, headers)
            else:
                err_body = e.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"OpenAI-compatible API HTTP {e.code}: {err_body}") from e

        return extract_json_from_text(content)

    def _post_json(self, url: str, payload: Dict[str, Any], headers: Dict[str, str]) -> str:
        """Executes the HTTP POST request to the chat completions endpoint and extracts message text."""
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.config.timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"]


class OllamaProvider(LLMProvider):
    """
    Native provider for local Ollama instances (`http://localhost:11434`).
    Supports both Ollama's native `/api/chat` with `format: "json"` and `/v1/chat/completions`.
    """

    def __init__(self, config: LLMConfig):
        """Initializes the local Ollama provider."""
        self.config = config
        self.model = config.model or "llama3.3"
        base = config.base_url or os.environ.get("OLLAMA_HOST") or "http://localhost:11434"
        self.base_url = base.rstrip("/")
        if self.base_url.endswith("/v1"):
            self.base_url = self.base_url[:-3]

    def generate_json(self, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """Calls Ollama's `/api/chat` endpoint with JSON mode enabled."""
        url = f"{self.base_url}/api/chat"
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        options: Dict[str, Any] = {"temperature": self.config.temperature}
        if self.config.max_tokens:
            options["num_predict"] = self.config.max_tokens
        options.update(self.config.extra_params)

        payload = {
            "model": self.model,
            "messages": messages,
            "format": "json",
            "stream": False,
            "options": options,
        }

        logger.info(f"Calling local Ollama at {url} (model={self.model})...")
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.config.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            content = data.get("message", {}).get("content", "")
            return extract_json_from_text(content)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Ollama API HTTP {e.code}: {err_body}") from e


class GeminiProvider(LLMProvider):
    """
    Provider for Google Gemini models using the `google-genai` SDK (with REST fallback).
    Defaults to `gemini-2.5-flash`.
    """

    def __init__(self, config: LLMConfig):
        """Initializes the Google Gemini provider."""
        self.config = config
        self.model = config.model or "gemini-2.5-flash"
        self.api_key = (
            _clean_api_key(config.api_key)
            or _clean_api_key(os.environ.get("GEMINI_API_KEY"))
            or _clean_api_key(os.environ.get("GOOGLE_API_KEY"))
        )
        if not self.api_key:
            raise ValueError(
                "Gemini API key not found. Set GEMINI_API_KEY / GOOGLE_API_KEY or pass api_key in LLMConfig."
            )

    def generate_json(self, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """Calls Google Gemini via `google-genai` SDK or REST endpoint and returns parsed JSON."""
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.api_key)
            logger.info(f"Calling Google Gemini SDK (model={self.model})...")
            response = client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt if system_prompt else None,
                    response_mime_type="application/json",
                    temperature=self.config.temperature,
                ),
            )
            return extract_json_from_text(response.text)
        except ImportError:
            logger.info(f"google-genai SDK not installed; using Gemini REST API (model={self.model})...")
            return self._call_gemini_rest(prompt, system_prompt)

    def _call_gemini_rest(self, prompt: str, system_prompt: str) -> Dict[str, Any]:
        """Fallback REST client for Google Gemini API so no extra SDK is strictly required."""
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
        payload: Dict[str, Any] = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": self.config.temperature,
                "responseMimeType": "application/json",
            },
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.config.timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return extract_json_from_text(text)


class AnthropicProvider(LLMProvider):
    """Provider for Anthropic Claude models via the Messages API."""

    def __init__(self, config: LLMConfig):
        """Initializes the Anthropic Claude provider."""
        self.config = config
        self.model = config.model or "claude-3-5-sonnet-latest"
        self.api_key = _clean_api_key(config.api_key) or _clean_api_key(os.environ.get("ANTHROPIC_API_KEY"))
        if not self.api_key:
            raise ValueError(
                "Anthropic API key not found. Set ANTHROPIC_API_KEY or pass api_key in LLMConfig."
            )
        self.base_url = (config.base_url or "https://api.anthropic.com/v1").rstrip("/")

    def generate_json(self, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """Calls Anthropic `/v1/messages` and parses the JSON response."""
        url = f"{self.base_url}/messages"
        payload: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.config.max_tokens or 8192,
            "temperature": self.config.temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system_prompt:
            payload["system"] = system_prompt

        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
        }

        logger.info(f"Calling Anthropic API (model={self.model})...")
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.config.timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = data["content"][0]["text"]
        return extract_json_from_text(text)


class LiteLLMProvider(LLMProvider):
    """Provider wrapping the `litellm` library to support 100+ local and cloud LLM providers."""

    def __init__(self, config: LLMConfig):
        """Initializes the LiteLLM provider."""
        self.config = config
        self.model = config.model or "gemini/gemini-2.5-flash"

    def generate_json(self, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """Calls `litellm.completion` and parses the returned JSON."""
        import litellm

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.config.temperature,
            "response_format": {"type": "json_object"},
        }
        if self.config.base_url:
            kwargs["api_base"] = self.config.base_url
        if self.config.api_key:
            kwargs["api_key"] = self.config.api_key
        if self.config.max_tokens:
            kwargs["max_tokens"] = self.config.max_tokens
        kwargs.update(self.config.extra_params)

        logger.info(f"Calling LiteLLM (model={self.model})...")
        response = litellm.completion(**kwargs)
        content = response.choices[0].message.content
        return extract_json_from_text(content)


class CallableLLMProvider(LLMProvider):
    """Adapter allowing a plain Python callable `fn(prompt, system_prompt) -> dict | str` to act as an LLMProvider."""

    def __init__(self, func: Callable[[str, str], Any]):
        """Wraps a user-supplied function as an LLMProvider."""
        self.func = func

    def generate_json(self, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """Invokes the user callable and ensures the output is a parsed dict."""
        result = self.func(prompt, system_prompt)
        if isinstance(result, dict):
            return result
        if isinstance(result, str):
            return extract_json_from_text(result)
        raise TypeError(f"Custom LLM callable must return dict or JSON str, got {type(result)}")


def create_llm_provider(
    config: Optional[LLMConfig] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    **kwargs: Any,
) -> LLMProvider:
    """
    Factory function that instantiates the configured `LLMProvider`.

    Supported `provider` values:
        - `"gemini"` / `"google"`: Google Gemini (`GeminiProvider`)
        - `"ollama"`: Local or remote Ollama server (`OllamaProvider`)
        - `"openai"` / `"vllm"` / `"lmstudio"` / `"llamacpp"` / `"openai-compatible"`:
          OpenAI or any OpenAI-compatible server (`OpenAICompatibleProvider`)
        - `"anthropic"` / `"claude"`: Anthropic Claude (`AnthropicProvider`)
        - `"litellm"`: LiteLLM universal router (`LiteLLMProvider`)
    """
    cfg = config or LLMConfig()
    if provider:
        cfg.provider = provider
    if model:
        cfg.model = model
    if base_url:
        cfg.base_url = base_url
    if api_key:
        cfg.api_key = api_key
    if kwargs:
        cfg.extra_params.update(kwargs)

    prov = cfg.provider.lower().strip()

    if prov in ("gemini", "google"):
        return GeminiProvider(cfg)
    if prov == "ollama":
        return OllamaProvider(cfg)
    if prov in ("openai", "openai-compatible", "openai_compatible", "vllm", "lmstudio", "llamacpp", "groq", "openrouter"):
        if prov == "vllm" and not cfg.base_url:
            cfg.base_url = "http://localhost:8000/v1"
        elif prov == "lmstudio" and not cfg.base_url:
            cfg.base_url = "http://localhost:1234/v1"
        elif prov == "llamacpp" and not cfg.base_url:
            cfg.base_url = "http://localhost:8080/v1"
        return OpenAICompatibleProvider(cfg)
    if prov in ("anthropic", "claude"):
        return AnthropicProvider(cfg)
    if prov == "litellm":
        return LiteLLMProvider(cfg)

    raise ValueError(
        f"Unknown LLM provider '{cfg.provider}'. Supported providers: "
        "'gemini', 'ollama', 'openai', 'vllm', 'lmstudio', 'llamacpp', 'anthropic', 'litellm'."
    )
