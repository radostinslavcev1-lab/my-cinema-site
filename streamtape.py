import os
import re
import logging
import requests

logger = logging.getLogger(__name__)

STREAMTAPE_API_BASE = "https://api.streamtape.com"


class StreamtapeAPIError(Exception):
    """Custom exception for Streamtape API failures."""
    pass


def extract_streamtape_id(raw_value: str, server_hint: str = 'auto') -> str:
    """
    Extracts the clean video ID (Streamtape or AnonMP4) from various link formats, iframe tags, or raw ID strings.
    server_hint can be: 'auto', 'anonmp4', or 'streamtape'.
    """
    if not raw_value:
        return ""

    raw_value = raw_value.strip()

    # If already prefixed
    if raw_value.startswith('anon:') or raw_value.startswith('anonmp4:'):
        clean = raw_value.split(':', 1)[1].strip()
        return f"anon:{clean}"

    # Extract URL if user pasted an iframe
    src_match = re.search(r'src=["\']([^"\']+)["\']', raw_value, re.IGNORECASE)
    eval_str = src_match.group(1).strip() if src_match else raw_value

    # 1. Broad AnonMP4 detection (matches anonmp4.to, anonmp4.art, anonmp4.com, etc. with any path)
    anon_pattern = r'anonmp4\.[a-z0-9\-]+/(?:v/|embed/|e/|d/|watch/)?([a-zA-Z0-9_\-]+)'
    anon_match = re.search(anon_pattern, eval_str, re.IGNORECASE)
    if anon_match:
        clean_id = anon_match.group(1).replace('.mp4', '').replace('.mkv', '').split('?')[0].split('&')[0].strip()
        if clean_id:
            return f"anon:{clean_id}"

    # Any other URL or string containing 'anonmp4'
    if 'anonmp4' in eval_str.lower():
        parts = eval_str.split('?')[0].split('#')[0].rstrip('/').split('/')
        if parts:
            clean_id = parts[-1].replace('.mp4', '').replace('.mkv', '').strip()
            if clean_id:
                return f"anon:{clean_id}"

    # 2. Pattern for standard Streamtape embed or watch links
    st_pattern = r'(?:streamtape\.[a-z]+|streamta\.pe)/(?:e|v)/([a-zA-Z0-9_\-]+)'
    st_match = re.search(st_pattern, eval_str, re.IGNORECASE)
    if st_match:
        return st_match.group(1)

    # 3. Clean raw value if it is a path or URL
    clean_val = eval_str.split('?')[0].split('#')[0].rstrip('/')
    if '/' in clean_val:
        clean_val = clean_val.split('/')[-1]

    clean_val = clean_val.replace('.mp4', '').replace('.mkv', '').strip()

    # 4. If explicit server hint is provided
    if server_hint == 'anonmp4':
        return f"anon:{clean_val}"
    elif server_hint == 'streamtape':
        return clean_val

    return clean_val


def get_upload_url(api_login: str, api_key: str, timeout: int = 15) -> str:
    """
    Step 1: Request an upload URL from Streamtape API.
    GET https://api.streamtape.com/file/ul?login={login}&key={key}
    """
    if not api_login or not api_key:
        raise StreamtapeAPIError("Липсват Streamtape API данни (STREAMTAPE_LOGIN или STREAMTAPE_KEY в .env).")

    url = f"{STREAMTAPE_API_BASE}/file/ul"
    params = {
        'login': api_login.strip(),
        'key': api_key.strip()
    }

    try:
        response = requests.get(url, params=params, timeout=timeout)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"Грешка при връзка със Streamtape API (Step 1): {e}")
        raise StreamtapeAPIError(f"Мрежова грешка при връзка със Streamtape: {str(e)}")
    except ValueError:
        raise StreamtapeAPIError("Streamtape върна невалиден JSON отговор.")

    status = data.get("status")
    msg = data.get("msg", "Unknown error")

    if status != 200:
        raise StreamtapeAPIError(f"Streamtape API отхвърли заявката: {msg} (код {status})")

    upload_url = data.get("result", {}).get("url")
    if not upload_url:
        raise StreamtapeAPIError("Streamtape не предостави валиден Upload URL.")

    return upload_url


def upload_file_to_streamtape(file_path: str, filename: str, api_login: str, api_key: str, timeout: int = 600) -> dict:
    """
    2-Step Upload:
      Step 1: Get upload URL.
      Step 2: POST multipart file to the upload URL.
      Step 3: Extract and return file_id and result data.
    """
    if not os.path.exists(file_path):
        raise StreamtapeAPIError(f"Файлът за качване не съществува: {file_path}")

    upload_url = get_upload_url(api_login, api_key)
    logger.info(f"Получен upload URL от Streamtape: {upload_url}")

    try:
        with open(file_path, 'rb') as f:
            files = {
                'file': (filename, f, 'application/octet-stream')
            }
            # Streamtape multipart upload
            upload_resp = requests.post(upload_url, files=files, timeout=timeout)
            upload_resp.raise_for_status()
            result_data = upload_resp.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"Грешка по време на качването на файл в Streamtape (Step 2): {e}")
        raise StreamtapeAPIError(f"Грешка при пренос на файла към Streamtape: {str(e)}")
    except ValueError:
        raise StreamtapeAPIError("Streamtape върна невалиден JSON отговор след качването.")

    status = result_data.get("status")
    msg = result_data.get("msg", "Unknown error")

    if status != 200:
        raise StreamtapeAPIError(f"Streamtape грешка при качване: {msg} (код {status})")

    file_info = result_data.get("result", {})
    file_id = file_info.get("id")

    if not file_id:
        raise StreamtapeAPIError("Streamtape не върна file_id за каченото видео.")

    return {
        'file_id': file_id,
        'url': file_info.get("url", f"https://streamtape.com/v/{file_id}"),
        'embed_url': f"https://streamtape.com/e/{file_id}/",
        'name': file_info.get("name", filename),
        'size': file_info.get("size", 0)
    }


def check_api_status(api_login: str, api_key: str, timeout: int = 8) -> dict:
    """
    Checks if the Streamtape API credentials are valid and active.
    GET https://api.streamtape.com/account/info?login={login}&key={key}
    """
    if not api_login or not api_key:
        return {
            'configured': False,
            'message': 'API ключовете не са зададени в .env'
        }

    url = f"{STREAMTAPE_API_BASE}/account/info"
    params = {'login': api_login.strip(), 'key': api_key.strip()}

    try:
        resp = requests.get(url, params=params, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") == 200:
                result = data.get("result", {})
                return {
                    'configured': True,
                    'valid': True,
                    'email': result.get("email", ""),
                    'message': 'API връзката е успешна и активна'
                }
            return {
                'configured': True,
                'valid': False,
                'message': data.get("msg", "Невалидни API данни")
            }
        return {
            'configured': True,
            'valid': False,
            'message': f"HTTP {resp.status_code} грешка от Streamtape"
        }
    except Exception as e:
        return {
            'configured': True,
            'valid': False,
            'message': f"Неуспешна връзка със Streamtape: {str(e)}"
        }
