import os
import re
import logging
import requests

logger = logging.getLogger(__name__)

STREAMTAPE_API_BASE = "https://api.streamtape.com"


class StreamtapeAPIError(Exception):
    """Custom exception for Streamtape API failures."""
    pass


def extract_streamtape_id(raw_value: str) -> str:
    """
    Extracts the clean Streamtape video ID from various link formats or raw ID strings.
    Supported examples:
      - https://streamtape.com/e/6w7qVbQqMphBq/
      - https://streamtape.com/v/6w7qVbQqMphBq/my_movie.mp4
      - https://streamta.pe/v/6w7qVbQqMphBq
      - https://streamtape.net/e/6w7qVbQqMphBq
      - 6w7qVbQqMphBq
    """
    if not raw_value:
        return ""

    raw_value = raw_value.strip()

    # Pattern for standard Streamtape embed or watch links
    pattern = r'(?:streamtape\.[a-z]+|streamta\.pe)/(?:e|v)/([a-zA-Z0-9_\-]+)'
    match = re.search(pattern, raw_value, re.IGNORECASE)
    if match:
        return match.group(1)

    # In case user pasted an iframe src or full tag
    src_match = re.search(r'src=["\']([^"\']+)["\']', raw_value)
    if src_match:
        nested_match = re.search(pattern, src_match.group(1), re.IGNORECASE)
        if nested_match:
            return nested_match.group(1)

    # If it's a raw identifier or ends with an ID
    clean_val = raw_value.split('?')[0].split('#')[0].rstrip('/')
    if '/' in clean_val:
        clean_val = clean_val.split('/')[-1]

    # Validate identifier format (usually alphanumeric with underscores/hyphens, length 8-25)
    clean_val = clean_val.replace('.mp4', '').replace('.mkv', '').strip()
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
