import os
import re
import logging
import requests

logger = logging.getLogger(__name__)

ABYSS_API_BASE = "https://api.abyss.to"
ABYSS_UPLOAD_BASE = "https://up.hydrax.net"
ABYSS_UPLOAD_FALLBACK = "https://up.abyss.to"
ABYSS_EMBED_BASE = "https://playhydrax.com/?v="
ABYSS_WATCH_BASE = "https://playhydrax.com/?v="


class AbyssAPIError(Exception):
    """Custom exception for Abyss.to API failures."""
    pass


def login_abyss(email: str, password: str, timeout: int = 15) -> dict:
    """
    Authenticate with Abyss.to using email and password to retrieve a JWT Bearer token.
    Endpoint: POST /auth/login
    Request: { "email": "...", "password": "..." }
    Response: { "token": "jwt-token-here", "expiresIn": 3600 }
    """
    if not email or not password:
        raise AbyssAPIError("Моля, въведете email и парола за Abyss.to.")

    url = f"{ABYSS_API_BASE}/auth/login"
    payload = {
        "email": email.strip(),
        "password": password.strip()
    }
    headers = {"Content-Type": "application/json"}

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        if not data.get("token"):
            raise AbyssAPIError(data.get("message") or "Неуспешен вход в Abyss.to.")
        return data
    except requests.exceptions.RequestException as e:
        logger.error(f"Abyss.to login error: {e}")
        raise AbyssAPIError(f"Грешка при вход в Abyss.to: {str(e)}")
    except ValueError:
        raise AbyssAPIError("Abyss.to върна невалиден JSON отговор.")


def check_abyss_status(api_key: str = None, token: str = None, timeout: int = 15) -> dict:
    """
    Checks Abyss.to API quota and connection validity.
    Endpoint: GET /v1/about?key={apiKey} or Header Authorization: Bearer {token}
    """
    if not api_key and not token:
        return {"valid": False, "message": "Липсва Abyss.to API Key или Auth Token."}

    url = f"{ABYSS_API_BASE}/v1/about"
    headers = {}
    params = {}

    if token:
        headers["Authorization"] = f"Bearer {token.strip()}"
    if api_key:
        params["key"] = api_key.strip()

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            storage = data.get("storageQuota", {})
            upload_quota = data.get("uploadQuota", {})
            max_upload_size = data.get("maxUploadSize", 10737418240)

            limit_gb = (storage.get("limit", 0) / (1024 ** 3))
            usage_gb = (storage.get("usage", 0) / (1024 ** 3))
            max_size_gb = (max_upload_size / (1024 ** 3))

            return {
                "valid": True,
                "limit_gb": f"{limit_gb:.1f} GB" if limit_gb else "Неограничен",
                "usage_gb": f"{usage_gb:.2f} GB",
                "max_upload_gb": f"{max_size_gb:.1f} GB",
                "storage": storage,
                "upload": upload_quota
            }
        elif resp.status_code == 401:
            return {"valid": False, "message": "Невалиден Abyss.to API Key или изтекъл токен (401 Unauthorized)."}
        else:
            return {"valid": False, "message": f"Сървърът на Abyss.to върна грешка: {resp.status_code}"}
    except requests.exceptions.RequestException as e:
        logger.error(f"Abyss.to about check error: {e}")
        return {"valid": False, "message": f"Няма връзка с Abyss.to API: {str(e)}"}


def get_abyss_file_info(file_id: str, api_key: str = None, token: str = None, timeout: int = 15) -> dict:
    """
    Retrieves metadata for an uploaded video file on Abyss.to.
    Endpoint: GET /v1/files/:id
    """
    if not file_id:
        raise AbyssAPIError("Липсва File ID.")

    clean_id = extract_abyss_id(file_id)
    url = f"{ABYSS_API_BASE}/v1/files/{clean_id}"
    headers = {}
    params = {}

    if token:
        headers["Authorization"] = f"Bearer {token.strip()}"
    if api_key:
        params["key"] = api_key.strip()

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"Abyss.to get_file_info error: {e}")
        raise AbyssAPIError(f"Грешка при четене на информация от Abyss.to: {str(e)}")


def upload_to_abyss(file_path: str, api_key: str, timeout: int = 600) -> dict:
    """
    Uploads a video file directly to Hydrax / Abyss.to using the provided API Key.
    Endpoint: POST https://up.hydrax.net/:key (or https://up.abyss.to/:key)
    Payload: multipart/form-data with 'file'
    Response: { "status": true, "slug": "file-id" }
    """
    if not api_key:
        api_key = "e46f14fa7d0b24e0e237e036071887b2"

    if not os.path.exists(file_path):
        raise AbyssAPIError(f"Файлът за качване не е намерен: {file_path}")

    filename = os.path.basename(file_path)
    clean_key = api_key.strip()
    
    # Try primary up.hydrax.net, fallback to up.abyss.to if network issue
    hosts = [ABYSS_UPLOAD_BASE, ABYSS_UPLOAD_FALLBACK]
    last_err = None

    for host in hosts:
        url = f"{host}/{clean_key}"
        try:
            with open(file_path, "rb") as f:
                files = {"file": (filename, f, "video/mp4")}
                resp = requests.post(url, files=files, timeout=timeout)
                resp.raise_for_status()
                data = resp.json()

            if data.get("status") is False:
                err_msg = data.get("msg") or data.get("message") or "Грешка при качване в Abyss/Hydrax."
                raise AbyssAPIError(err_msg)

            slug = data.get("slug") or data.get("video_id") or data.get("id")
            if not slug:
                raise AbyssAPIError(data.get("msg") or data.get("message") or "Abyss/Hydrax не върна видео slug/ID след качване.")

            return {
                "success": True,
                "slug": slug,
                "video_id": slug,
                "embed_url": f"https://playhydrax.com/?v={slug}",
                "watch_url": f"https://playhydrax.com/?v={slug}",
                "cdn_url": f"https://abysscdn.com/?v={slug}"
            }
        except AbyssAPIError:
            raise
        except requests.exceptions.RequestException as e:
            last_err = e
            logger.warning(f"Failed upload to {host}, trying next host: {e}")
            continue
        except ValueError:
            raise AbyssAPIError("Сървърът за качване върна невалиден отговор.")

    raise AbyssAPIError(f"Грешка при качване на файл в Abyss/Hydrax: {str(last_err)}")


def extract_abyss_id(raw_value: str) -> str:
    """
    Extracts the clean Abyss / Hydrax file ID/slug from URLs, iframes, or prefixed strings.
    Supports:
      - abyss:xeAVhv8gH
      - hydrax:xeAVhv8gH
      - https://playhydrax.com/?v=xeAVhv8gH
      - https://abyss.to/embed/xeAVhv8gH
      - https://abyss.to/v/xeAVhv8gH
      - https://abysscdn.com/?v=xeAVhv8gH
      - http://up.hydrax.net/:key
      - <iframe src="https://playhydrax.com/?v=xeAVhv8gH"></iframe>
      - raw slug (e.g. xeAVhv8gH)
    """
    if not raw_value:
        return ""

    raw = raw_value.strip()

    if raw.startswith("abyss:"):
        return raw.split(":", 1)[1].strip()
    if raw.startswith("hydrax:"):
        return raw.split(":", 1)[1].strip()

    # If inside an iframe tag
    src_match = re.search(r'src=["\']([^"\']+)["\']', raw, re.IGNORECASE)
    eval_str = src_match.group(1).strip() if src_match else raw

    # Match playhydrax.com/?v=... or abysscdn.com/?v=... or hydrax.net/?v=...
    m_v = re.search(r'(?:playhydrax\.com|abysscdn\.com|hydrax\.net)/.*[?&]v=([a-zA-Z0-9_\-]+)', eval_str, re.IGNORECASE)
    if m_v:
        return m_v.group(1).strip()

    # Match abyss.to/embed/... or abyss.to/v/... or hydrax.net/watch/...
    m_slug = re.search(r'(?:abyss\.to|hydrax\.net)/(?:embed|v|watch)/([a-zA-Z0-9_\-]+)', eval_str, re.IGNORECASE)
    if m_slug:
        return m_slug.group(1).strip()

    # Raw slug clean-up
    parts = eval_str.split("?")[0].rstrip("/").split("/")
    return parts[-1].strip()
