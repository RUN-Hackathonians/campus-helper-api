#Step 1: load keys
import os
from dotenv import load_dotenv

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from groq import Groq
groq_client = Groq(api_key=GROQ_API_KEY)
def ask_groq(prompt):
    try:
        groq_response = groq_client.chat.completions.create(
            model = "openai/gpt-oss-120b",
            messages = [{"role": "user", "content":prompt}]
        )
        
        return groq_response.choices[0].message.content
    except Exception as error_message:
        print(f"Groq Failed: {error_message}")  
        return None


from google import genai
gemini_client = genai.Client(api_key=GEMINI_API_KEY)
def ask_gemini(prompt):
    try:
        chat = gemini_client.chats.create(model="gemini-3-flash-preview")
        gemini_response = chat.send_message(prompt)
        
        return gemini_response.text
    except Exception as error_message:
        print(f"Gemini Failed: {error_message}")
        return None


def ask_ai(prompt):
    result_groq = ask_groq(prompt)
    if result_groq is not None:
        return result_groq
    result_gemini = ask_gemini(prompt)
    if result_gemini is not None:
        return result_gemini
    return {"error": "all_providers_failed", "message": "Try again later."}
if __name__ == "__main__":
    print(ask_ai("Say hello in one sentence."))