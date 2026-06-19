import os
import json
from groq import Groq
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Groq client
# If GROQ_API_KEY is not set, we run in Mock Sandbox mode
api_key = os.getenv("GROQ_API_KEY", "")
client = None
if api_key:
    client = Groq(api_key=api_key)

def is_configured():
    return client is not None

def _generate_mock_schema_from_prompt(prompt: str) -> dict:
    """
    Simulates AI extracting target fields dynamically based on the prompt's keywords.
    Ensures that offline sandbox forms are customized to the user's input, not hardcoded.
    """
    fields = []
    prompt_lower = prompt.lower()
    
    # Keyword-based extraction heuristics
    if "name" in prompt_lower or "user" in prompt_lower or "customer" in prompt_lower or "people" in prompt_lower:
        fields.append({
            "id": "respondent_name", 
            "label": "Full Name", 
            "type": "text", 
            "required": True, 
            "description": "Name of the participant",
            "pacing_question": "To start off, could you tell me your name?"
        })
        
    if "pricing" in prompt_lower or "price" in prompt_lower or "cost" in prompt_lower or "billing" in prompt_lower or "subscription" in prompt_lower:
        fields.append({
            "id": "pricing_friction", 
            "label": "Pricing Friction Details", 
            "type": "choice", 
            "choices": ["Too expensive", "Regional currency issues", "Fair value"], 
            "required": True, 
            "description": "Feedback on pricing models",
            "pacing_question": "How did you find our pricing structure? Is there any feedback on the tiers?"
        })
        
    if "speed" in prompt_lower or "lag" in prompt_lower or "slow" in prompt_lower or "performance" in prompt_lower or "db" in prompt_lower or "database" in prompt_lower or "load" in prompt_lower:
        fields.append({
            "id": "performance_issues", 
            "label": "Performance & Lag Bottlenecks", 
            "type": "text", 
            "required": True, 
            "description": "Specific details on speed loading or database lag",
            "pacing_question": "Have you noticed any lag or speed bottlenecks while working on your database?"
        })
        
    if "supabase" in prompt_lower or "firebase" in prompt_lower or "competitor" in prompt_lower or "migrate" in prompt_lower or "switch" in prompt_lower:
        fields.append({
            "id": "competitor_migration", 
            "label": "Competitor Migration Status", 
            "type": "choice", 
            "choices": ["Migrated to Supabase", "Migrated to Firebase", "No migration"], 
            "required": False, 
            "description": "Details on migration to alternatives",
            "pacing_question": "What tools or alternative databases are you considering migrating to?"
        })

    # File, Picture, and URL mock prompts
    if any(w in prompt_lower for w in ["photo", "picture", "image", "screenshot", "upload"]):
        fields.append({
            "id": "attached_screenshot",
            "label": "Screenshot or Image attachment",
            "type": "picture",
            "required": False,
            "description": "Uploaded image or screenshot detailing the issue",
            "pacing_question": "If you have a screenshot or image of the issue, could you upload it here?"
        })

    if any(w in prompt_lower for w in ["file", "document", "pdf", "attachment"]):
        fields.append({
            "id": "attached_document",
            "label": "Document or File attachment",
            "type": "file",
            "required": False,
            "description": "Uploaded document or log file",
            "pacing_question": "Could you share the relevant log file or document with us?"
        })

    if any(w in prompt_lower for w in ["url", "link", "website", "homepage"]):
        fields.append({
            "id": "website_url",
            "label": "Website URL",
            "type": "url",
            "required": False,
            "description": "Website or landing page address",
            "pacing_question": "What is the link to your website or page?"
        })

    # Check for custom words to build customized target fields if standard categories don't match
    words = [w.strip("?,.!:;()\"'") for w in prompt.split() if len(w) > 4 and w.lower() not in ["survey", "need", "identify", "details", "feedback", "cancel", "customer"]]
    
    if len(fields) < 2 and words:
        target_word_1 = words[0].capitalize()
        fields.append({
            "id": f"target_{words[0].lower()}",
            "label": f"{target_word_1} Feedback Details",
            "type": "text",
            "required": True,
            "description": f"Details regarding {words[0].lower()}",
            "pacing_question": f"Could you tell me a little bit about your thoughts on {words[0].lower()}?"
        })
        if len(words) > 1 and len(fields) < 3:
            target_word_2 = words[1].capitalize()
            fields.append({
                "id": f"target_{words[1].lower()}",
                "label": f"{target_word_2} Satisfaction Rating (1-5)",
                "type": "number",
                "required": False,
                "description": f"Numeric rating for {words[1].lower()}",
                "pacing_question": f"On a scale of 1 to 5, how would you rate your satisfaction with {words[1].lower()}?"
            })

    if not fields:
        fields = [
            {"id": "feedback_topic", "label": "Primary Feedback Area", "type": "text", "required": True, "description": "What area of the app is this feedback for?", "pacing_question": "To kick things off, what primary feedback area did you want to discuss?"},
            {"id": "satisfaction_rating", "label": "Satisfaction Rating (1-5)", "type": "number", "required": True, "description": "Numeric satisfaction score", "pacing_question": "On a scale of 1 to 5, how would you rate your overall satisfaction?"},
            {"id": "improvement_notes", "label": "Suggestions for Improvement", "type": "text", "required": False, "description": "What changes would you like to see?", "pacing_question": "What specific improvements or changes would you like to suggest?"}
        ]
        
    return {
        "title": f"Survey: {prompt[:30].strip()}...",
        "objective": f"Assess parameters for: {prompt}",
        "schema_fields": fields,
        "guardrails": {
            "system_instructions": "Stay warm, casual, and empathetic. Do not prompt answers.",
            "topics_allowed": "Any topic relevant to user survey."
        },
        "settings": {
            "allow_voice": True,
            "fatigue_threshold": 0.7,
            "code_switching": True
        }
    }

def generate_form_schema(prompt: str) -> dict:
    """
    Takes a natural language prompt and compiles it into a structured
    form title, objective, schema fields, and guardrails.
    """
    if not client:
        return _generate_mock_schema_from_prompt(prompt)
 
    system_prompt = (
        "You are an expert system designer. You take a user's description of a survey objective "
        "and generate a structured Form config in JSON. You must ONLY output JSON. "
        "The output must match this JSON structure:\n"
        "{\n"
        "  \"title\": \"A clear, brief title for the form\",\n"
        "  \"objective\": \"Detailed operational objective summarizing what the conversation should discover\",\n"
        "  \"schema_fields\": [\n"
        "    {\n"
        "      \"id\": \"unique_snake_case_id\",\n"
        "      \"label\": \"Human readable question label\",\n"
        "      \"type\": \"text\" | \"number\" | \"choice\" | \"url\" | \"picture\" | \"file\",\n"
        "      \"required\": true | false,\n"
        "      \"choices\": [\"Only if type is choice, list options\"] or null,\n"
        "      \"description\": \"What this field aims to capture\",\n"
        "      \"pacing_question\": \"A warm, open-ended, and highly casual way to ask for this information naturally in a chat conversation (e.g. 'To get started, I'd love to know what tools you currently use?')\"\n"
        "    }\n"
        "  ],\n"
        "  \"guardrails\": {\n"
        "    \"system_instructions\": \"Direct instructions for the conversational bot, e.g. Stay neutral, avoid biased words, do not pitch product X.\",\n"
        "    \"topics_allowed\": \"Allowed themes of debate\"\n"
        "  },\n"
        "  \"settings\": {\n"
        "    \"allow_voice\": true,\n"
        "    \"fatigue_threshold\": 0.7,\n"
        "    \"code_switching\": true\n"
        "  }\n"
        "}"
    )
 
    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Generate a form for this request: '{prompt}'"}
            ],
            response_format={"type": "json_object"},
            temperature=0.2
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"Error calling Groq for schema: {e}")
        # Return fallback on error directly instead of recursive calls (fixes infinite recursion bug!)
        return _generate_mock_schema_from_prompt(prompt)

def generate_form_schema_from_webpage(url: str, text_content: str, prompt: str = "") -> dict:
    """
    Scrapes the text content of a company homepage, extracts their brand details,
    and returns a structured Form config matching the page's domain and tone.
    """
    if not client:
        return _generate_mock_schema_from_webpage(url, prompt)

    system_prompt = (
        "You are an expert brand analyst and conversational flow designer.\n"
        "You are given a target company's URL and the raw text scraped from their homepage.\n"
        "Your task is to analyze their product features, brand voice, and customer target group, "
        "and design a customized conversational survey schema in JSON. You must ONLY output JSON.\n\n"
        "The output must match this JSON structure:\n"
        "{\n"
        "  \"title\": \"A clear, brief title representing the brand survey (e.g. 'Supabase Developer Survey')\",\n"
        "  \"objective\": \"Detailed operational objective summarizing what the conversation should discover from their users\",\n"
        "  \"schema_fields\": [\n"
        "    {\n"
        "      \"id\": \"unique_snake_case_id\",\n"
        "      \"label\": \"Human readable question label\",\n"
        "      \"type\": \"text\" | \"number\" | \"choice\" | \"url\" | \"picture\" | \"file\",\n"
        "      \"required\": true | false,\n"
        "      \"choices\": [\"Only if type is choice, list options\"] or null,\n"
        "      \"description\": \"What this field aims to capture\",\n"
        "      \"pacing_question\": \"A warm, open-ended, and highly casual way to ask for this information naturally in a chat conversation\"\n"
        "    }\n"
        "  ],\n"
        "  \"guardrails\": {\n"
        "    \"system_instructions\": \"Direct instructions for the conversational bot matching the brand tone. E.g. Stay technical and precise, use developer terminology, remain empathetic and helpful.\",\n"
        "    \"topics_allowed\": \"Comma separated list of allowed keywords or themes of debate based on their products\"\n"
        "  },\n"
        "  \"settings\": {\n"
        "    \"allow_voice\": true,\n"
        "    \"fatigue_threshold\": 0.7,\n"
        "    \"code_switching\": true\n"
        "  }\n"
        "}"
    )

    try:
        user_prompt_clause = ""
        if prompt:
            user_prompt_clause = f"\nAdditionally, customize the survey according to this specific user directive: '{prompt}'"

        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"URL: {url}\n\nWebpage text content:\n{text_content[:8000]}{user_prompt_clause}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.2
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"Error calling Groq for webpage schema: {e}")
        return _generate_mock_schema_from_webpage(url, prompt)

def _generate_mock_schema_from_webpage(url: str, prompt: str = "") -> dict:
    # Extract domain name
    domain = "brand"
    try:
        if "://" in url:
            domain = url.split("://")[-1].split("www.")[-1].split(".")[0].lower()
    except Exception:
        pass
    
    # Capitalize for title
    name = domain.capitalize() if domain else "Your Brand"
    prompt_lower = prompt.lower()
    
    # Tailored mock responses
    if "stripe" in domain:
        title = "Stripe Payment Integration Survey"
        objective = "Understand developer experience with Stripe SDKs, billing API latency, and payment gateway checkout friction."
        fields = [
            {"id": "developer_experience", "label": "API integration experience", "type": "choice", "choices": ["Extremely easy", "Moderate friction", "Difficult"], "required": True, "description": "Ease of integrating Stripe APIs"},
            {"id": "latency_concerns", "label": "Webhooks or API latency issues", "type": "text", "required": False, "description": "Webhook and request processing speed"},
            {"id": "billing_tier_value", "label": "Billing products satisfaction (1-5)", "type": "number", "required": True, "description": "Rating of Stripe Billing options"}
        ]
        allowed = "payments, stripe, api, billing, latency, checkout, integration"
        instr = "Be highly technical and developer-focused. Use precise engineering terms."
    elif "supabase" in domain:
        title = "Supabase Database Scaling Survey"
        objective = "Identify developer bottlenecks with real-time replication, Row-Level Security policy setup, and pgvector clustering."
        fields = [
            {"id": "postgres_experience", "label": "PostgreSQL management friction", "type": "text", "required": True, "description": "Issues with migrations or scaling databases"},
            {"id": "rls_friction", "label": "Row-Level Security policy setup ease", "type": "choice", "choices": ["Straightforward", "Highly complex", "Bypassed it"], "required": True, "description": "RLS policy friction"},
            {"id": "realtime_latency", "label": "Real-time subscriptions speed", "type": "text", "required": False, "description": "Latency in realtime websocket connections"}
        ]
        allowed = "supabase, postgres, database, rls, scaling, postgresql, vector"
        instr = "Stay highly technical. Speak to the user as a database administrator or platform engineer."
    elif "formplus" in domain or "formpl" in domain:
        title = "FormPulse Competitor Churn Survey"
        objective = "Extract feedback from users evaluating Formplus. Pinpoint areas related to file uploads, styling flexibility, and document generation."
        fields = [
            {"id": "migration_reason", "label": "Primary reason for testing alternatives", "type": "choice", "choices": ["Better pricing", "More flexible API", "Conversational AI capabilities"], "required": True, "description": "Reason for switching from Formplus"},
            {"id": "doc_merge_value", "label": "Importance of automated document generation (1-5)", "type": "number", "required": True, "description": "Valuation of Form2Doc / Document Merge feature"},
            {"id": "offline_needs", "label": "Offline form collection requirements", "type": "text", "required": False, "description": "Details on field offline data collection usage"}
        ]
        allowed = "formplus, document merge, form2doc, data collection, templates, offline"
        instr = "Remain professional and objective. Focus strictly on tool comparisons without bias."
    else:
        # General brand survey
        title = f"{name} Customer Experience Survey"
        objective = f"Expose user onboarding friction, product adoption bottlenecks, and brand positioning opportunities for {name}."
        fields = [
            {"id": "onboarding_friction", "label": "Onboarding speed or setup blockers", "type": "text", "required": True, "description": "Issues faced when first signing up"},
            {"id": "core_value", "label": "Most valuable product feature", "type": "text", "required": True, "description": "Feature driving the most value"},
            {"id": "nps_score", "label": "Recommendation score (1-10)", "type": "number", "required": True, "description": "Net Promoter Score"}
        ]
        allowed = f"{domain}, onboarding, product, features, satisfaction"
        instr = "Be friendly, professional, and helpful. Guide the conversation casual but focused."

    # Parse custom instructions in prompt to customize mock fields
    if "orm" in prompt_lower:
        fields.append({
            "id": "orm_choice",
            "label": "Database ORM tools preference",
            "type": "choice",
            "choices": ["Prisma", "Drizzle", "SQLAlchemy", "Sequelize", "Raw SQL"],
            "required": True,
            "description": "ORM chosen for integration"
        })
    if "pricing" in prompt_lower or "price" in prompt_lower:
        fields.append({
            "id": "pricing_tier_feedback",
            "label": "Feedback on pricing structure",
            "type": "text",
            "required": False,
            "description": "Friction points with cost or tier selections"
        })
    if "speed" in prompt_lower or "performance" in prompt_lower or "latency" in prompt_lower:
        fields.append({
            "id": "speed_feedback",
            "label": "Performance or speed bottlenecks",
            "type": "text",
            "required": False,
            "description": "Details on API response latency or database speeds"
        })

    # Enrich fields with mock pacing questions
    for f in fields:
        if "pacing_question" not in f or not f["pacing_question"]:
            f["pacing_question"] = f"Could you tell me about your {f['label'].lower()}?"

    return {
        "title": title,
        "objective": objective,
        "schema_fields": fields,
        "guardrails": {
            "system_instructions": instr,
            "topics_allowed": allowed
        },
        "settings": {
            "allow_voice": True,
            "fatigue_threshold": 0.7,
            "code_switching": True
        }
    }

def plan_conversational_flow(title: str, objective: str, fields: list) -> list:
    """
    Planning Agent: Takes a form's title, objective, and a list of extraction fields.
    Returns the fields list where each field is guaranteed to have a 'pacing_question'
    (a casual, warm phrasing designed to extract that specific field naturally).
    """
    enriched_fields = []
    
    # If client is not configured, generate mock pacing questions
    if not client:
        for f in fields:
            field_copy = dict(f)
            if "pacing_question" not in field_copy or not field_copy["pacing_question"]:
                label_lower = field_copy["label"].lower()
                desc = field_copy.get("description", "")
                desc_text = f" ({desc})" if desc else ""
                
                if "name" in label_lower:
                    field_copy["pacing_question"] = f"To kick things off, what's your name?{desc_text}"
                elif "price" in label_lower or "cost" in label_lower or "tier" in label_lower:
                    field_copy["pacing_question"] = f"What are your thoughts on the pricing or billing setup?{desc_text}"
                elif "performance" in label_lower or "speed" in label_lower or "lag" in label_lower:
                    field_copy["pacing_question"] = f"Did you experience any performance lags or speed issues?{desc_text}"
                elif "recommend" in label_lower or "rating" in label_lower:
                    field_copy["pacing_question"] = f"On a scale of 1 to 5, how would you rate your overall experience?{desc_text}"
                else:
                    field_copy["pacing_question"] = f"Could you share your thoughts on: {field_copy['label']}?{desc_text}"
            enriched_fields.append(field_copy)
        return enriched_fields

    # If client is configured, run a structured LLM Planning Agent
    system_prompt = (
        "You are a Conversation Planner Agent for FormPulse.\n"
        "Your task is to take a survey's title, core objective, and list of target extraction fields. "
        "For each field, generate a 'pacing_question'.\n"
        "A pacing_question is a friendly, casual, open-ended, and highly natural way for a B2B user researcher "
        "to ask for that information on WhatsApp or Slack.\n\n"
        "RULES:\n"
        "1. Do NOT sound robotic, cold, or like a structured questionnaire.\n"
        "2. Keep questions concise (1 short sentence) and warm. Do NOT ask leading questions.\n"
        "3. Preserve all existing properties of the fields. Only add or update the 'pacing_question' property.\n"
        "4. Return ONLY a JSON array containing the updated list of fields."
    )

    user_content = json.dumps({
        "title": title,
        "objective": objective,
        "fields": fields
    }, indent=2)

    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Here is the form metadata and fields:\n{user_content}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.2
        )
        data = json.loads(completion.choices[0].message.content)
        # Handle different wrapping structures returned by LLM
        result_fields = data.get("fields", data.get("schema_fields", data))
        if isinstance(result_fields, list):
            return result_fields
        return fields
    except Exception as e:
        print(f"Error in plan_conversational_flow: {e}")
        # Local mock generation fallback
        for f in fields:
            field_copy = dict(f)
            if "pacing_question" not in field_copy or not field_copy["pacing_question"]:
                field_copy["pacing_question"] = f"Could you tell me about: {field_copy['label']}?"
            enriched_fields.append(field_copy)
        return enriched_fields

def process_conversation_turn(form_dict: dict, history: list, extracted_so_far: dict, latest_input: str) -> dict:
    """
    Core conversational survey loop turn.
    Sends conversation + target schema to Groq.
    Returns:
      - next_message: Text response to send to the respondent.
      - extracted_data: Map of variables extracted.
      - fatigue_rating: 'low', 'medium', 'high'.
      - form_complete: boolean indicating if survey objective is met or user is exhausted.
    """
    if not client:
        return _mock_conversation_turn(form_dict, history, extracted_so_far, latest_input)

    # Compile the prompt including target schema, current state, and guardrails
    fields_desc = json.dumps(form_dict["schema_fields"], indent=2)
    state_desc = json.dumps(extracted_so_far, indent=2)
    guardrails_desc = json.dumps(form_dict.get("guardrails", {}), indent=2)

    # Format the message history for the LLM
    formatted_history = []
    for msg in history:
        formatted_history.append(f"{msg['role'].upper()}: {msg['content']}")
    formatted_history.append(f"USER (LATEST): {latest_input}")
    chat_history_str = "\n".join(formatted_history)

    system_prompt = (
        "You are FormPulse, an objective-driven conversational survey bot. "
        "Your goal is to conduct a survey and extract structured variables from a respondent's unstructured dialogue.\n\n"
        f"SURVEY OBJECTIVE:\n{form_dict['objective']}\n\n"
        f"GUARDRAILS & SYSTEM INSTRUCTIONS:\n{guardrails_desc}\n\n"
        f"TARGET SCHEMA FIELDS:\n{fields_desc}\n\n"
        f"EXTRACTED DATA SO FAR:\n{state_desc}\n\n"
        "YOUR INSTRUCTIONS:\n"
        "1. Read the chat history and the LATEST USER INPUT.\n"
        "2. Parse the input to extract any new values matching the TARGET SCHEMA. "
        "Merge them with the EXTRACTED DATA SO FAR. (Be smart: parse numbers, boolean flags, choice lists, code-switching dialects, or text descriptions).\n"
        "3. Evaluate user FATIGUE. (If their messages are getting extremely short, they express frustration, or seem eager to finish, set fatigue to 'medium' or 'high').\n"
        "4. Determine if the FORM IS COMPLETE. The form is complete if: all required fields are filled, OR the user displays high fatigue, OR you have sufficiently satisfied the qualitative objectives.\n"
        "5. Formulate your NEXT MESSAGE:\n"
        "  - Talk like a very warm, casual, and empathetic human researcher on WhatsApp or Slack. Do NOT sound like a robotic questionnaire or a cold interviewer.\n"
        "  - Handle User Questions/Clarifications: If the user asks a question, requests clarification (e.g. 'Why do you ask that?', 'What do you mean by pricing?', etc.), or seeks information about the context, you MUST answer their question directly, clearly, and concisely. Provide a helpful response using the context of the SURVEY OBJECTIVE. Once answered, gently transition back to the survey (e.g. 'Hope that clarifies! To continue...', 'Does that make sense? So, ...') before asking the pacing question.\n"
        "  - Use Active Listening: Always validate and acknowledge their input before moving on (e.g. 'Oh wow, database lag is the absolute worst' or 'Aha, pricing is a huge factor, I get that').\n"
        "  - Use Psychological Engagement: Formulate questions open-endedly and casually to make the user feel comfortable sharing more detail.\n"
        "  - For target fields that are not yet extracted, look up their pre-planned 'pacing_question' property in the TARGET SCHEMA FIELDS. You MUST adapt and use this casual 'pacing_question' to prompt the user for that field, rather than asking for the raw label directly. This is crucial to maintain flow.\n"
        "  - Keep sentences short, neat, and highly natural. Do NOT ask leading questions. Remain completely unbiased.\n"
        "  - If the form is complete (form_complete is true), politely wrap up the conversation and thank them. Under NO circumstances ask any further questions or end the message with a question mark.\n"
        "6. Respond ONLY in a JSON object with this format:\n"
        "{\n"
        "  \"extracted_data\": { ... },\n"
        "  \"fatigue_rating\": \"low\" | \"medium\" | \"high\",\n"
        "  \"form_complete\": true | false,\n"
        "  \"next_message\": \"Your message here\"\n"
        "}"
    )

    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Here is the dialogue history and the latest user input:\n{chat_history_str}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.3
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"Error calling Groq for chat turn: {e}")
        return _mock_conversation_turn(form_dict, history, extracted_so_far, latest_input)

def transcribe_audio(audio_file_path: str) -> str:
    """
    Transcribes uploaded audio files using Groq Whisper.
    """
    if not client:
        return "[Mock Audio Transcription] User voice notes processed. They mentioned: syncing databases can lag when editing table records."

    try:
        with open(audio_file_path, "rb") as file:
            transcription = client.audio.transcriptions.create(
                file=(os.path.basename(audio_file_path), file.read()),
                model="whisper-large-v3",
                response_format="text"
            )
            return transcription
    except Exception as e:
        print(f"Error transcribing audio: {e}")
        return f"[Audio Transcription Error: {e}]"

def _mock_conversation_turn(form_dict: dict, history: list, extracted_so_far: dict, latest_input: str) -> dict:
    """
    Local mock fallback for when GROQ_API_KEY is not set.
    Directly loops through the target fields to simulate a conversation.
    """
    # Simple mock logic
    fields = form_dict["schema_fields"]
    new_extracted = dict(extracted_so_far)

    # Guess extraction from latest_input
    # Find the first field that isn't extracted yet
    current_field = None
    for f in fields:
        if f["id"] not in new_extracted:
            current_field = f
            break

    # Mock extract if we had a current field
    if current_field and latest_input:
        val = latest_input.strip()
        # Parse basic types
        if current_field["type"] == "number":
            try:
                val = int(val)
            except ValueError:
                pass
        new_extracted[current_field["id"]] = val

    # Find the next empty field
    next_field = None
    for f in fields:
        if f["id"] not in new_extracted:
            next_field = f
            break

    # Calculate fatigue based on message length
    fatigue = "low"
    if latest_input and len(latest_input) < 10:
        # Very short message, fatigue increases
        fatigue = "medium"
    if len(history) >= 8:
        fatigue = "high"

    # Wrap up if no next field or high fatigue
    form_complete = next_field is None or fatigue == "high"

    # Dynamic casual validation responses based on field types
    validation = "Got it, thanks. "
    if latest_input:
        cleaned_in = latest_input.lower()
        if len(latest_input) > 25:
            validation = "Ah, that makes a lot of sense, I appreciate the detail. "
        elif "bug" in cleaned_in or "lag" in cleaned_in or "slow" in cleaned_in:
            validation = "Oh wow, that sounds really frustrating. I totally get why that's a bottleneck. "
        elif "expensive" in cleaned_in or "price" in cleaned_in or "cost" in cleaned_in:
            validation = "Yeah, pricing is always a major factor. I hear you. "
        else:
            validation = "Great, got it. "

    if form_complete:
        msg = f"{validation}Thanks so much for taking the time to share your thoughts with me today! We've recorded your responses."
    else:
        # Use planned pacing question if available
        pacing_q = next_field.get("pacing_question", "")
        if pacing_q:
            msg = f"{validation}{pacing_q}"
        else:
            label_lower = next_field['label'].lower()
            desc_text = f" ({next_field['description']})" if next_field.get('description') else ""
            if "name" in label_lower:
                msg = f"Hey! Thanks for chatting. To kick things off, what's your name?{desc_text}"
            elif "price" in label_lower or "cost" in label_lower or "tier" in label_lower:
                msg = f"{validation}By the way, what were your thoughts on the pricing or billing setup?{desc_text}"
            elif "performance" in label_lower or "speed" in label_lower or "lag" in label_lower or "slow" in label_lower or "issue" in label_lower or "need" in label_lower:
                msg = f"{validation}Got a quick question: did you run into any performance lags, bugs, or specific issues while using the platform?{desc_text}"
            elif "recommend" in label_lower or "rating" in label_lower or "score" in label_lower:
                msg = f"{validation}I'd love to know, on a scale of 1 to 5, how did you feel about your overall experience?{desc_text}"
            else:
                msg = f"{validation}Could you tell me a bit about your thoughts on: {next_field['label'].lower()}?{desc_text}"

    return {
        "extracted_data": new_extracted,
        "fatigue_rating": fatigue,
        "form_complete": form_complete,
        "next_message": msg
    }

def generate_opening_question(form_dict: dict) -> str:
    """
    Uses Groq to generate a highly casual, warm opening question
    that introduces the survey objective and naturally segues into the first field.
    """
    fields = form_dict.get("schema_fields", [])
    first_field = fields[0] if fields else {"label": "general feedback", "description": "thoughts"}
    first_pacing = first_field.get("pacing_question", f"Could you share a bit about your {first_field.get('label', 'feedback')}?")
    
    if not client:
        return f"Hey there! Thanks for taking a moment to chat. To kick things off, {first_pacing[0].lower() + first_pacing[1:] if first_pacing else ''}"
        
    objective = form_dict.get("objective", "General feedback")
    
    system_prompt = (
        "You are FormPulse, a warm, highly casual B2B conversational researcher. "
        "Your job is to generate a welcoming, single-sentence greeting and opening question for a survey session.\n\n"
        f"SURVEY OBJECTIVE: {objective}\n"
        f"FIRST TARGET FIELD PACING QUESTION: {first_pacing}\n\n"
        "INSTRUCTIONS:\n"
        "1. Do NOT sound like a form or robotic script. Speak like a friendly person on Slack or WhatsApp.\n"
        "2. Say a quick hello, state what we're looking to learn very briefly, and then use or adapt the FIRST TARGET FIELD PACING QUESTION naturally to kick off the conversation.\n"
        "3. Keep it to 1-2 short, highly natural sentences. Do NOT ask multiple questions. Only ask about the first target field."
    )
    
    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Generate the opening greeting and question."}
            ],
            temperature=0.7,
            max_tokens=100
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error generating opening question: {e}")
        return f"Hey there! Thanks for taking a moment to chat. To start, {first_pacing[0].lower() + first_pacing[1:] if first_pacing else ''}"

def refine_form_schema(current_schema: dict, prompt: str) -> dict:
    """
    Takes an existing form schema and a prompt, and uses Groq to refine/expand the schema in-place.
    """
    if not client:
        schema = dict(current_schema)
        fields = list(schema.get("schema_fields", []))
        words = [w.strip("?,.!:;()\"'") for w in prompt.split() if len(w) > 4]
        word = words[0].capitalize() if words else "Refined"
        fields.append({
            "id": f"refined_{word.lower()}",
            "label": f"{word} Feedback Details",
            "type": "text",
            "required": False,
            "description": f"Details regarding {prompt}",
            "pacing_question": f"Could you tell me a little bit about: {prompt}?"
        })
        schema["schema_fields"] = fields
        return schema

    system_prompt = (
        "You are an expert system designer. You take an existing Form configuration (JSON) "
        "and a refinement prompt, and return a modified Form configuration in JSON.\n\n"
        "EXISTING CONFIG:\n" + json.dumps(current_schema, indent=2) + "\n\n"
        "INSTRUCTIONS:\n"
        "1. Understand the refinement request: modify the title, objective, settings, or add/edit/delete fields in the schema_fields.\n"
        "2. Keep existing fields unless the prompt asks to remove or change them. Ensure all field IDs are unique.\n"
        "3. For all fields in the schema_fields list, make sure they have the pacing_question property (a casual, warm, conversational phrasing to ask about that field on WhatsApp/Slack).\n"
        "4. Output ONLY valid JSON matching the format of the existing config."
    )

    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Refine the form schema based on this prompt: '{prompt}'"}
            ],
            response_format={"type": "json_object"},
            temperature=0.2
        )
        result = json.loads(completion.choices[0].message.content)
        return result
    except Exception as e:
        print(f"Error refining schema: {e}")
        return current_schema
