import os
import sys
import json
import shutil
from fastapi.testclient import TestClient

# Add backend directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../asik/convo form/backend")))

# Set environment variables for testing (SQLite mode)
os.environ["SUPABASE_DATABASE_URL"] = ""
os.environ["SUPABASE_JWT_SECRET"] = ""

from main import app, get_db
from database import SessionLocal, init_db, Form, Session as SurveySession, Response

# Re-init db
init_db()

client = TestClient(app)

def test_inputs_flow():
    print("--- 1. Testing Manual Form Creation with New Field Types ---")
    form_payload = {
        "title": "Beta User Feedback Survey",
        "objective": "Collect website link, screenshots of the UI, and log files.",
        "schema_fields": [
            {
                "id": "user_fullname",
                "label": "Full Name",
                "type": "text",
                "required": True,
                "description": "Full name of the developer"
            },
            {
                "id": "landing_page",
                "label": "Landing Page URL",
                "type": "url",
                "required": True,
                "description": "User's company URL"
            },
            {
                "id": "error_screenshot",
                "label": "UI Error Screenshot",
                "type": "picture",
                "required": False,
                "description": "Screenshot of the UI bottleneck"
            },
            {
                "id": "log_attachment",
                "label": "System Log file",
                "type": "file",
                "required": False,
                "description": "Console text logs file"
            }
        ],
        "guardrails": {"system_instructions": "Be friendly.", "topics_allowed": "feedback"},
        "settings": {"allow_voice": True, "fatigue_threshold": 0.7, "code_switching": True}
    }

    # Create form (using mock-auth sandbox mode)
    response = client.post("/api/forms", json=form_payload)
    assert response.status_code == 200, f"Form creation failed: {response.text}"
    form = response.json()
    form_id = form["id"]
    print(f"[OK] Form created successfully. ID: {form_id}")

    # Double check that types are saved correctly
    fields = form["schema_fields"]
    assert fields[0]["type"] == "text"
    assert fields[1]["type"] == "url"
    assert fields[2]["type"] == "picture"
    assert fields[3]["type"] == "file"
    print("[OK] Schema types verified in DB.")

    print("\n--- 2. Testing Session Init and Active Field Tracking ---")
    session_response = client.post("/api/sessions", json={"form_id": form_id})
    assert session_response.status_code == 200, f"Session init failed: {session_response.text}"
    session = session_response.json()
    session_id = session["id"]
    
    # Assert active_field is the first unextracted field (user_fullname)
    active = session["active_field"]
    assert active is not None
    assert active["id"] == "user_fullname"
    assert active["type"] == "text"
    print(f"[OK] Session initialized. Next active field: {active['id']} ({active['type']})")

    print("\n--- 3. Simulating First Turn (Text Answer) ---")
    respond_response = client.post(
        f"/api/sessions/{session_id}/respond",
        data={"message": "Asik Kani"}
    )
    assert respond_response.status_code == 200, f"Respond failed: {respond_response.text}"
    res = respond_response.json()
    
    # Assert fullname was extracted and next active field is landing_page (url)
    extracted = res["session"]["extracted_data"]
    next_active = res["session"]["active_field"]
    assert "user_fullname" in extracted
    assert next_active is not None
    assert next_active["id"] == "landing_page"
    assert next_active["type"] == "url"
    print(f"[OK] Text response processed. Next active field: {next_active['id']} ({next_active['type']})")

    print("\n--- 4. Testing File Upload Endpoint (Local Fallback Mode) ---")
    # Prepare a dummy text file to simulate upload
    dummy_filename = "test_log.txt"
    with open(dummy_filename, "w") as f:
        f.write("Log dump: ERROR database connection timeout.")

    try:
        with open(dummy_filename, "rb") as file_data:
            upload_response = client.post(
                f"/api/sessions/{session_id}/upload",
                files={"file": (dummy_filename, file_data, "text/plain")}
            )
        assert upload_response.status_code == 200, f"Upload failed: {upload_response.text}"
        upload_data = upload_response.json()
        file_url = upload_data["url"]
        
        # Verify it has local static prefix
        assert file_url.startswith("/api/uploads/"), f"Unexpected URL structure: {file_url}"
        print(f"[OK] Upload endpoint succeeded. Uploaded URL: {file_url}")

        # Verify static file is readable
        static_filename = file_url.split("/")[-1]
        static_response = client.get(file_url)
        assert static_response.status_code == 200, f"Failed to retrieve static file: {static_response.text}"
        assert b"database connection timeout" in static_response.content
        print("[OK] Static file retrieval verified (returns correct file contents).")
    finally:
        # Cleanup dummy local file
        if os.path.exists(dummy_filename):
            os.remove(dummy_filename)

    print("\n--- 5. Testing Response Direct URL Injection ---")
    # Simulate respondent uploading an error screenshot to the error_screenshot field
    injected_img_url = "/api/uploads/injected_image.png"
    respond_inject = client.post(
        f"/api/sessions/{session_id}/respond",
        data={
            "file_url": injected_img_url,
            "file_field_id": "error_screenshot"
        }
    )
    assert respond_inject.status_code == 200, f"Direct injection failed: {respond_inject.text}"
    inject_res = respond_inject.json()
    
    # Assert it got direct mapped into extracted data without needing LLM parsing
    extracted_state = inject_res["session"]["extracted_data"]
    assert "error_screenshot" in extracted_state
    assert extracted_state["error_screenshot"] == injected_img_url
    print(f"[OK] Injected file URL mapped directly: {extracted_state['error_screenshot']}")
    
    # Clean uploads created during tests
    if os.path.exists("uploads"):
        for name in os.listdir("uploads"):
            if name.startswith(session_id):
                try:
                    os.remove(os.path.join("uploads", name))
                except:
                    pass

    print("\n>>> ALL MULTI-TYPE INPUTS FLOW TESTS PASSED! <<<")

if __name__ == "__main__":
    test_inputs_flow()
