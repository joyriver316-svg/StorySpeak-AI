import os
import json
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI()

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.getenv("API_KEY")
GEMINI_TRANSCRIBE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
GEMINI_TTS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent"

@app.get("/")
async def root():
    return "StorySpeak Backend is running (Python/FastAPI)!"

@app.post("/api/transcribe")
async def transcribe(request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    audio_base64 = body.get("audioBase64")
    mime_type = body.get("mimeType")

    if not audio_base64 or not mime_type:
        raise HTTPException(status_code=400, detail="audioBase64 and mimeType are required")

    gemini_body = {
        "contents": [
            {
                "parts": [
                    {"inlineData": {"data": audio_base64, "mimeType": mime_type}},
                    {"text": "위 음성 파일의 내용을 텍스트로 그대로 받아적어주세요. 들리는 대로 정확하게 텍스트만 출력하세요. 추가적인 설명은 생략하세요."}
                ]
            }
        ]
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{GEMINI_TRANSCRIBE_ENDPOINT}?key={API_KEY}",
                json=gemini_body,
                headers={"Content-Type": "application/json"},
                timeout=30.0
            )
            data = response.json()
            
            if response.status_code != 200:
                print("Gemini transcribe error:", data)
                error_msg = data.get("error", {}).get("message", "Gemini API error")
                return JSONResponse(status_code=response.status_code, content={"error": error_msg})

            text = ""
            if "candidates" in data and data["candidates"]:
                parts = data["candidates"][0].get("content", {}).get("parts", [])
                for part in parts:
                    if "text" in part:
                        text = part["text"]
                        break
            
            return {"text": text}

        except httpx.RequestError as e:
            print(f"Transcribe request error: {e}")
            return JSONResponse(status_code=500, content={"error": "Internal server error"})


@app.post("/api/generateSpeech")
async def generate_speech(request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    text = body.get("text")
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    gemini_body = {
        "model": "gemini-2.5-flash-preview-tts",
        "contents": [{"parts": [{"text": f"Speak naturally and clearly: {text}"}]}],
        "config": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Kore"}}},
        },
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{GEMINI_TTS_ENDPOINT}?key={API_KEY}",
                json=gemini_body,
                headers={"Content-Type": "application/json"},
                timeout=30.0
            )
            data = response.json()

            if response.status_code != 200:
                print("Gemini TTS error:", data)
                error_msg = data.get("error", {}).get("message", "Gemini TTS error")
                return JSONResponse(status_code=response.status_code, content={"error": error_msg})

            audio_base64 = ""
            if "candidates" in data and data["candidates"]:
                parts = data["candidates"][0].get("content", {}).get("parts", [])
                for part in parts:
                    if "inlineData" in part:
                        audio_base64 = part["inlineData"].get("data", "")
                        break
            
            return {"audioBase64": audio_base64}

        except httpx.RequestError as e:
            print(f"TTS request error: {e}")
            return JSONResponse(status_code=500, content={"error": "Internal server error"})

# PDF Management
from fastapi.staticfiles import StaticFiles
from fastapi import UploadFile, File
import shutil

PDF_DIR = "pdfs"
if not os.path.exists(PDF_DIR):
    os.makedirs(PDF_DIR)

app.mount("/pdfs", StaticFiles(directory=PDF_DIR), name="pdfs")

@app.post("/api/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    try:
        file_path = os.path.join(PDF_DIR, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"filename": file.filename, "url": f"/pdfs/{file.filename}"}
    except Exception as e:
        print(f"Upload error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/pdfs")
async def list_pdfs():
    try:
        files = [f for f in os.listdir(PDF_DIR) if f.endswith('.pdf')]
        # Sort by modification time (newest first)
        files.sort(key=lambda x: os.path.getmtime(os.path.join(PDF_DIR, x)), reverse=True)
        return {"files": files}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4000)
