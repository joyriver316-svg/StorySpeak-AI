// f:/pro/storyspeak-ai/backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const GEMINI_TRANSCRIBE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GEMINI_TTS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';
const API_KEY = process.env.API_KEY;

app.get('/', (req, res) => {
    res.send('StorySpeak Backend is running!');
});

// ---------- Transcribe ----------
app.post('/api/transcribe', async (req, res) => {
    const { audioBase64, mimeType } = req.body;
    if (!audioBase64 || !mimeType) {
        return res.status(400).json({ error: 'audioBase64 and mimeType are required' });
    }
    try {
        const body = {
            contents: [
                {
                    parts: [
                        { inlineData: { data: audioBase64, mimeType } },
                        { text: '위 음성 파일의 내용을 텍스트로 그대로 받아적어주세요. 들리는 대로 정확하게 텍스트만 출력하세요. 추가적인 설명은 생략하세요.' }
                    ]
                }
            ],
        };
        const response = await fetch(`${GEMINI_TRANSCRIBE_ENDPOINT}?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('Gemini transcribe error:', data);
            return res.status(response.status).json({ error: data.error?.message || 'Gemini API error' });
        }
        const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
        res.json({ text });
    } catch (err) {
        console.error('Transcribe error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------- Text‑to‑Speech ----------
app.post('/api/generateSpeech', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    try {
        const body = {
            model: 'gemini-2.5-flash-preview-tts',
            contents: [{ parts: [{ text: `Speak naturally and clearly: ${text}` }] }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            },
        };
        const response = await fetch(`${GEMINI_TTS_ENDPOINT}?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('Gemini TTS error:', data);
            return res.status(response.status).json({ error: data.error?.message || 'Gemini TTS error' });
        }
        const audioBase64 =
            data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data || '';
        res.json({ audioBase64 });
    } catch (err) {
        console.error('TTS error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Backend listening on http://localhost:${PORT}`));
