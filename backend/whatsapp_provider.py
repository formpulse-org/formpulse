import os
import httpx

PICKY_ASSIST_TOKEN = os.getenv("PICKY_ASSIST_TOKEN", "")
PICKY_ASSIST_APP_ID = os.getenv("PICKY_ASSIST_APP_ID", "1")
PICKY_ASSIST_URL = "https://app.pickyassist.com/api/v2/push"

def send_whatsapp_message(number: str, text: str, session_id: str = "default"):
    """
    Sends a WhatsApp message asynchronously via Picky Assist Push API.
    """
    if not PICKY_ASSIST_TOKEN:
        print("Warning: PICKY_ASSIST_TOKEN is not set.")
        return None

    # Format number for Picky Assist (Country code without +)
    clean_number = "".join(c for c in number if c.isdigit())

    payload = {
        "token": PICKY_ASSIST_TOKEN,
        "application": PICKY_ASSIST_APP_ID,
        "globalmessage": text,
        "globalmedia": "",
        "data": [
            {
                "number": clean_number,
                "message": text
            }
        ]
    }
    
    try:
        response = httpx.post(PICKY_ASSIST_URL, json=payload, timeout=15.0)
        response.raise_for_status()
        print(f"WhatsApp message sent successfully via Picky Assist to {clean_number}")
        return response.json()
    except Exception as e:
        print(f"Failed to send WhatsApp message via Picky Assist: {e}")
        return None
