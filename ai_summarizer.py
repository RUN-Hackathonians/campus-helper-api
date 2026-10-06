#Step 1: load your keys
import os
from dotenv import load_dotenv

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
print("GROQ_API_KEY found:", GROQ_API_KEY is not None)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
print("GEMINI_API_KEY found:", GEMINI_API_KEY is not None)

#Step 2: Call AI's simple question, phase1: calling Groq 
from groq import Groq
groq_client = Groq(api_key=GROQ_API_KEY)
groq_response = groq_client.chat.completions.create(
    model = "openai/gpt-oss-120b",
    messages = [{"role": "user", "content": "say hello in one sentence."}]
)
print(groq_response.choices[0].message.content)

#Phase 2: Call Gemini (Our Failover Backup)
from google import genai
gemini_client = genai.Client(api_key=GEMINI_API_KEY)
gemini_response = gemini_client.models.generate_content(
    model = "gemini-3.8-flash",
    contents = "Say hello in one sentence."
)
print(gemini_response.text)

#Step 2: Writing
