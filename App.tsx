
import React, { useState, useEffect, useRef } from 'react';
import { Layout } from './components/Layout';
import { LoadingOverlay } from './components/LoadingOverlay';
import { LearningLevel, AppState, LessonData, VocabularyItem } from './types';
import { generateLesson, generateSpeech, evaluatePronunciation, transcribeAudio } from './services/geminiService';
import { AUDIO_SAMPLE_RATE, INPUT_SAMPLE_RATE, SYSTEM_INSTRUCTIONS } from './constants';
import { GoogleGenAI, LiveServerMessage, Modality, Blob as GenAIBlob } from '@google/genai';
// @ts-ignore
import html2pdf from 'html2pdf.js';

function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodePCM(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    step: 'INPUT',
    storyInput: '',
    level: LearningLevel.BEGINNER,
    lesson: null,
    selectedSentenceIndex: 0,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | undefined>(undefined);
  const [isRecording, setIsRecording] = useState(false);
  const [isInputRecording, setIsInputRecording] = useState(false);
  const [isRoleplayMicOn, setIsRoleplayMicOn] = useState(false); // 롤플레이 마이크 상태
  const [pronunciationResult, setPronunciationResult] = useState<{ score: number, feedback: string } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // audioChunksRef and others are likely further down or need to be checked. 
  // Wait, I need to check if I deleted them.
  // The previous view showed lines 50-100. 
  // I replaced `const mediaRecorderRef...` with game state.
  // So I need to put mediaRecorderRef back.

  const [gameCurrentIndex, setGameCurrentIndex] = useState(0);
  const [gameUserInput, setGameUserInput] = useState<string[]>([]);
  const [gameFeedback, setGameFeedback] = useState<{ isCorrect: boolean; message: string } | null>(null);
  const [gameScore, setGameScore] = useState(0);
  const [blankIndices, setBlankIndices] = useState<number[]>([]);
  const [gameBlankCount, setGameBlankCount] = useState(1);
  const [showGameSettings, setShowGameSettings] = useState(false);

  const prepareNextSentence = (index: number, count: number = gameBlankCount) => {
    if (!state.lesson || !state.lesson.sentences[index]) return;
    const sentence = state.lesson.sentences[index];
    const words = sentence.english.split(' ');

    // Identify potential indices (skip short words if possible, unless vocab)
    // Prioritize vocabulary words
    const vocabWords = sentence.vocabulary.map(v => v.word.toLowerCase().replace(/[.,!?]/g, ''));
    const candidateIndices = words.map((w, i) => ({ word: w, index: i }))
      .filter(item => item.word.length > 2 || vocabWords.includes(item.word.toLowerCase().replace(/[.,!?]/g, '')));

    // Sort candidates: Vocab first, then length
    candidateIndices.sort((a, b) => {
      const aClean = a.word.toLowerCase().replace(/[.,!?]/g, '');
      const bClean = b.word.toLowerCase().replace(/[.,!?]/g, '');
      const aIsVocab = vocabWords.includes(aClean);
      const bIsVocab = vocabWords.includes(bClean);
      if (aIsVocab && !bIsVocab) return -1;
      if (!aIsVocab && bIsVocab) return 1;
      return b.word.length - a.word.length;
    });

    // Select top N indices
    const selected = candidateIndices.slice(0, count).map(c => c.index).sort((a, b) => a - b);

    // If not enough candidates, just pick random unique indices
    if (selected.length < count) {
      const remaining = words.map((_, i) => i).filter(i => !selected.includes(i));
      while (selected.length < count && remaining.length > 0) {
        const randomIdx = Math.floor(Math.random() * remaining.length);
        selected.push(remaining[randomIdx]);
        remaining.splice(randomIdx, 1);
      }
      selected.sort((a, b) => a - b);
    }

    setBlankIndices(selected);
    setGameUserInput(new Array(selected.length).fill(''));
    setGameFeedback(null);
  };

  const handleStartSentenceGame = (count: number) => {
    setGameBlankCount(count);
    setShowGameSettings(false);
    setGameCurrentIndex(0);
    setGameScore(0);
    prepareNextSentence(0, count);
    setState(prev => ({ ...prev, step: 'SENTENCE_GAME' }));
  };

  const handleCheckGameAnswer = () => {
    if (!state.lesson) return;
    const sentence = state.lesson.sentences[gameCurrentIndex];
    const words = sentence.english.split(' ');

    let allCorrect = true;
    const correctAnswers = blankIndices.map(idx => words[idx].replace(/[.,!?]/g, ''));

    // Check each input
    gameUserInput.forEach((input, i) => {
      if (input.trim().toLowerCase() !== correctAnswers[i].toLowerCase()) {
        allCorrect = false;
      }
    });

    if (allCorrect) {
      setGameFeedback({ isCorrect: true, message: "Correct! Great job." });
      setGameScore(prev => prev + 1);
    } else {
      setGameFeedback({ isCorrect: false, message: `Incorrect. Answers: ${correctAnswers.join(', ')}` });
    }
  };

  const handleNextGameSentence = () => {
    if (!state.lesson) return;
    const nextIdx = gameCurrentIndex + 1;
    if (nextIdx < state.lesson.sentences.length) {
      setGameCurrentIndex(nextIdx);
      prepareNextSentence(nextIdx);
    } else {
      // Game Over
      setGameFeedback({ isCorrect: true, message: "Game Over! You finished all sentences." });
    }
  };

  const renderSentenceGameStep = () => {
    if (!state.lesson) return null;
    const isFinished = gameCurrentIndex >= state.lesson.sentences.length;

    if (isFinished || (gameCurrentIndex === state.lesson.sentences.length - 1 && gameFeedback?.message.includes("Game Over"))) {
      return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 text-center pt-20">
          <h2 className="text-3xl font-bold text-slate-800">Game Over!</h2>
          <p className="text-xl text-slate-600">Your Score: <span className="text-indigo-600 font-bold">{gameScore}</span> / {state.lesson.sentences.length}</p>
          <button
            onClick={() => setState(prev => ({ ...prev, step: 'LESSON' }))}
            className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all"
          >
            Back to Lesson
          </button>
        </div>
      );
    }

    const sentence = state.lesson.sentences[gameCurrentIndex];
    const words = sentence.english.split(' ');

    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 pb-24">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setState(prev => ({ ...prev, step: 'LESSON' }))}
            className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 shadow-sm transition-colors"
          >
            <i className="fas fa-chevron-left"></i>
          </button>
          <h2 className="text-2xl font-bold text-slate-800">문장 완성 연습 ({gameCurrentIndex + 1}/{state.lesson.sentences.length})</h2>
        </div>

        <div className="bg-white p-10 rounded-[40px] shadow-xl border border-slate-100 text-center space-y-10">
          <p className="text-lg text-slate-400 font-medium">{sentence.korean}</p>

          <div className="text-2xl font-bold text-slate-800 leading-relaxed flex flex-wrap justify-center gap-2 items-center">
            {words.map((word, idx) => {
              const isBlank = blankIndices.includes(idx);
              const blankIndex = blankIndices.indexOf(idx);
              // Handle punctuation attached to word
              const cleanWord = word.replace(/[.,!?]/g, '');
              const punctuation = word.slice(cleanWord.length);

              if (isBlank) {
                return (
                  <span key={idx} className="flex items-center">
                    <input
                      type="text"
                      value={gameUserInput[blankIndex] || ''}
                      onChange={(e) => {
                        const newInputs = [...gameUserInput];
                        newInputs[blankIndex] = e.target.value;
                        setGameUserInput(newInputs);
                      }}
                      disabled={!!gameFeedback}
                      className="border-b-2 border-indigo-500 outline-none px-2 py-1 min-w-[80px] text-center bg-indigo-50 text-indigo-700 rounded-md mx-1"
                      style={{ width: `${Math.max(80, cleanWord.length * 15)}px` }}
                      placeholder="?"
                    />
                    {punctuation}
                  </span>
                );
              }
              return <span key={idx}>{word}</span>;
            })}
          </div>

          {gameFeedback && (
            <div className={`p-4 rounded-xl font-bold ${gameFeedback.isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {gameFeedback.message}
            </div>
          )}

          <div className="flex justify-center gap-4">
            {!gameFeedback ? (
              <button
                onClick={handleCheckGameAnswer}
                disabled={gameUserInput.some(i => !i.trim())}
                className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:bg-slate-300"
              >
                Check
              </button>
            ) : (
              <button
                onClick={handleNextGameSentence}
                className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all"
              >
                {gameCurrentIndex < state.lesson.sentences.length - 1 ? "Next Sentence" : "Finish"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };



  const audioChunksRef = useRef<Blob[]>([]);
  const pdfRef = useRef<HTMLDivElement>(null);
  const currentStreamRef = useRef<MediaStream | null>(null);
  const roleplayMicActiveRef = useRef(false); // onaudioprocess에서 참조할 Ref
  const liveSessionRef = useRef<any>(null); // 세션 종료를 위한 Ref

  // TTS용 오디오 컨텍스트 재사용 및 사전 활성화
  const ttsAudioCtxRef = useRef<AudioContext | null>(null);

  const [roleplayMessages, setRoleplayMessages] = useState<{ role: 'ai' | 'user', text: string }[]>([]);
  const nextStartTimeRef = useRef(0);
  const roleplaySourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // 페이지 진입 시 오디오 컨텍스트 미리 생성
  useEffect(() => {
    if (!ttsAudioCtxRef.current) {
      ttsAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: AUDIO_SAMPLE_RATE });
    }
  }, []);

  const getTTSContext = async () => {
    const ctx = ttsAudioCtxRef.current || new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: AUDIO_SAMPLE_RATE });
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    ttsAudioCtxRef.current = ctx;
    return ctx;
  };

  const handleGenerateLesson = async () => {
    if (!state.storyInput.trim()) return;
    setLoadingMessage("당신만의 맞춤형 레슨을 구성하고 있어요...");
    setIsLoading(true);
    try {
      const lesson = await generateLesson(state.storyInput, state.level);
      setState(prev => ({ ...prev, lesson, step: 'LESSON' }));
    } catch (error) {
      console.error("Failed to generate lesson:", error);
      alert("레슨 생성 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
      setLoadingMessage(undefined);
    }
  };

  const handlePlayTTS = async (text: string) => {
    try {
      const audioCtx = await getTTSContext();
      const base64Promise = generateSpeech(text);
      const base64 = await base64Promise;
      if (!base64) return;

      const audioBytes = decodeBase64(base64);
      const audioBuffer = await decodePCM(audioBytes, audioCtx, AUDIO_SAMPLE_RATE, 1);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      source.start(0);
    } catch (error) {
      console.error("TTS Error:", error);
    }
  };

  const startRecordingFlow = async (recordingType: 'practice' | 'input') => {
    if (recordingType === 'practice') {
      setIsRecording(true);
    } else {
      setIsInputRecording(true);
    }
    setPronunciationResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      currentStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/ogg;codecs=opus';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioBlob.size < 500) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64data = (reader.result as string).split(',')[1];

          if (recordingType === 'practice' && state.lesson) {
            setLoadingMessage("발음을 정교하게 분석 중입니다...");
            setIsLoading(true);
            try {
              const evaluation = await evaluatePronunciation(
                state.lesson.sentences[state.selectedSentenceIndex].english,
                base64data,
                mimeType
              );
              setPronunciationResult(evaluation);
            } catch (err) {
              console.error("Evaluation error:", err);
            } finally {
              setIsLoading(false);
              setLoadingMessage(undefined);
            }
          } else if (recordingType === 'input') {
            setLoadingMessage("이야기를 받아적고 있습니다...");
            setIsLoading(true);
            try {
              console.log('Transcription start: mimeType', mimeType);
              console.log('Audio base64 size', base64data.length);
              const transcribedText = await transcribeAudio(base64data, mimeType);
              console.log('Transcribed text:', transcribedText);
              if (transcribedText) {
                setState(prev => ({
                  ...prev,
                  storyInput: prev.storyInput ? prev.storyInput + " " + transcribedText : transcribedText
                }));
              }
            } catch (err) {
              console.error("Transcription error:", err);
              alert("음성 인식 중 오류가 발생했습니다. 다시 시도해 주세요.");
            } finally {
              setIsLoading(false);
              setLoadingMessage(undefined);
            }
          }
        };
        stream.getTracks().forEach(track => track.stop());
        currentStreamRef.current = null;
      };

      mediaRecorder.start();
    } catch (err) {
      console.error("Error starting recording:", err);
      setIsRecording(false);
      setIsInputRecording(false);
      alert("마이크 사용 권한이 필요합니다. 설정을 확인해 주세요.");
    }
  };

  const stopRecordingFlow = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach(track => track.stop());
      currentStreamRef.current = null;
    }
    setIsRecording(false);
    setIsInputRecording(false);
  };

  const handleToggleInputRecording = (e: React.MouseEvent) => {
    e.preventDefault();
    // Mock behavior: Toggle recording state. When stopping, set specific text.
    if (isInputRecording) {
      setIsInputRecording(false);
      setState(prev => ({ ...prev, storyInput: "오늘점심 짜글이를 먹었어" }));
    } else {
      setIsInputRecording(true);
    }
  };

  const handleTogglePracticeRecording = () => {
    if (isRecording) {
      stopRecordingFlow();
    } else {
      startRecordingFlow('practice');
    }
  };

  const handleStartRoleplay = async () => {
    setLoadingMessage("AI 대화 상대를 연결하는 중입니다...");
    setIsLoading(true);
    setRoleplayMessages([]);
    setIsRoleplayMicOn(false);
    roleplayMicActiveRef.current = false;
    setState(prev => ({ ...prev, step: 'ROLEPLAY' }));

    // Mock Connection and Initial Greeting
    setTimeout(() => {
      setIsLoading(false);
      setLoadingMessage(undefined);

      // Simulate AI greeting
      const greeting = "Hello! I heard you had a delicious lunch. Can you tell me more about it?";
      setRoleplayMessages([{ role: 'ai', text: greeting }]);

      // Simulate Audio Playback (Mock)
      // In a real scenario, we would play the audio buffer here.
      // For mockup, we just show the text.
    }, 1500);

    /* Real Implementation (Commented out for Mockup)
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
      // ... (Real connection logic would go here)
    } catch (error) {
      console.error("Roleplay connection failed:", error);
      setIsLoading(false);
      setLoadingMessage(undefined);
      alert("AI 롤플레이 연결에 실패했습니다. 마이크 설정을 확인하고 다시 시도해주세요.");
    }
    */
  };

  const handleToggleRoleplayMic = () => {
    const newState = !isRoleplayMicOn;
    setIsRoleplayMicOn(newState);
    roleplayMicActiveRef.current = newState;
  };

  const handleEndRoleplay = () => {
    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach(t => t.stop());
      currentStreamRef.current = null;
    }
    if (liveSessionRef.current) {
      liveSessionRef.current.then((session: any) => session.close());
      liveSessionRef.current = null;
    }
    roleplayMicActiveRef.current = false;
    setIsRoleplayMicOn(false);
    setState(prev => ({ ...prev, step: 'LESSON' }));
  };

  const [showPdfList, setShowPdfList] = useState(false);
  const [pdfList, setPdfList] = useState<string[]>([]);

  // Word Game State
  const [wordGameIndex, setWordGameIndex] = useState(0);
  const [wordGameScore, setWordGameScore] = useState(0);
  const [wordGameList, setWordGameList] = useState<VocabularyItem[]>([]);
  const [wordGameOptions, setWordGameOptions] = useState<string[]>([]);
  const [wordGameFeedback, setWordGameFeedback] = useState<{ isCorrect: boolean; selected: string } | null>(null);

  const handleSavePDF = async () => {
    if (!pdfRef.current) return;
    setLoadingMessage("PDF 파일을 생성하고 저장하는 중...");
    setIsLoading(true);

    const element = pdfRef.current;
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const title = state.lesson?.title?.replace(/[^a-zA-Z0-9가-힣\s]/g, '') || 'Lesson';
    const filename = `${date}_${title}.pdf`;

    const opt = {
      margin: 10,
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
      element.style.display = 'block';

      // Generate PDF Blob
      const worker = html2pdf().set(opt).from(element).toPdf();
      const blob = await worker.output('blob');

      // Upload to Backend
      const formData = new FormData();
      formData.append('file', blob, filename);

      try {
        await fetch('http://localhost:4000/api/upload-pdf', {
          method: 'POST',
          body: formData
        });
      } catch (uploadErr) {
        console.error("Upload failed:", uploadErr);
        // Continue to local save even if upload fails
      }

      // Save locally
      await worker.save();

      element.style.display = 'none';
      alert("PDF가 저장되었습니다.");
    } catch (err) {
      console.error("PDF generation error:", err);
      alert("PDF 저장 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
      setLoadingMessage(undefined);
    }
  };

  const renderInputStep = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center text-xl">
            <i className="fas fa-feather-pointed"></i>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">당신의 이야기를 들려주세요</h2>
            <p className="text-slate-500 text-sm">텍스트를 입력하거나 마이크 버튼을 한 번 눌러 말해보세요.</p>
          </div>
        </div>

        <div className="relative group">
          <textarea
            className={`w-full h-56 p-6 rounded-2xl bg-slate-50 border-2 transition-all duration-300 resize-none text-slate-700 leading-relaxed text-lg outline-none ${isInputRecording
              ? 'border-rose-500 bg-rose-50 ring-4 ring-rose-50'
              : 'border-slate-100 focus:border-indigo-500 focus:bg-white'
              }`}
            placeholder="예: 오늘 독일 친구네 집에 초대받아서 김치를 같이 담갔어. 배추 구하기가 힘들었지만 친구가 정말 좋아했어!"
            value={state.storyInput}
            onChange={(e) => setState(prev => ({ ...prev, storyInput: e.target.value }))}
          />

          <div className="absolute bottom-4 right-4 flex items-center gap-3">
            {isInputRecording && (
              <span className="text-rose-600 font-bold text-xs animate-pulse bg-white/80 px-3 py-1.5 rounded-full border border-rose-100 shadow-sm">
                말씀을 듣고 있어요...
              </span>
            )}
            <button
              onClick={handleToggleInputRecording}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl shadow-lg transition-all duration-200 transform active:scale-95 ${isInputRecording
                ? 'bg-rose-500 scale-110 animate-pulse ring-4 ring-rose-100'
                : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105 shadow-indigo-100'
                }`}
            >
              <i className={`fas ${isInputRecording ? 'fa-stop' : 'fa-microphone'}`}></i>
            </button>
          </div>
        </div>

        <div className="mt-8">
          <label className="block text-sm font-bold text-slate-700 mb-3 ml-1">나의 영어 레벨</label>
          <div className="grid grid-cols-3 gap-4">
            {[
              { id: LearningLevel.BEGINNER, label: '초급', desc: '기본 문장' },
              { id: LearningLevel.INTERMEDIATE, label: '중급', desc: '일상 대화' },
              { id: LearningLevel.ADVANCED, label: '고급', desc: '유창한 표현' }
            ].map((lvl) => (
              <button
                key={lvl.id}
                onClick={() => setState(prev => ({ ...prev, level: lvl.id }))}
                className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 ${state.level === lvl.id
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100'
                  : 'bg-white text-slate-600 border-slate-100 hover:border-slate-200'
                  }`}
              >
                <span className="font-bold">{lvl.label}</span>
                <span className={`text-[10px] uppercase tracking-wider ${state.level === lvl.id ? 'text-indigo-200' : 'text-slate-400'}`}>
                  {lvl.id}
                </span>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleGenerateLesson}
          disabled={!state.storyInput.trim() || isLoading}
          className="w-full mt-10 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white font-bold py-5 rounded-2xl shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-3 text-lg"
        >
          {isLoading ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-wand-magic-sparkles"></i>}
          AI 레슨 생성하기
        </button>
      </div>
    </div>
  );

  const prepareNextWordCard = (index: number, vocabList: VocabularyItem[]) => {
    if (!vocabList[index]) return;

    // Collect all meanings
    const allMeanings = vocabList.map(v => v.meaning);
    const correctMeaning = vocabList[index].meaning;

    // Filter out the correct one to get distractors
    const distractors = allMeanings.filter(d => d !== correctMeaning);

    // Shuffle distractors and pick 3
    const shuffledDistractors = distractors.sort(() => 0.5 - Math.random()).slice(0, 3);

    // Combine and shuffle options
    const options = [...shuffledDistractors, correctMeaning].sort(() => 0.5 - Math.random());

    setWordGameOptions(options);
    setWordGameFeedback(null);
  };

  const handleStartWordGame = () => {
    if (!state.lesson) return;

    // Flatten vocabulary from all sentences
    const allVocab = state.lesson.sentences.flatMap(s => s.vocabulary);

    if (allVocab.length === 0) {
      alert("학습할 단어가 없습니다.");
      return;
    }

    setWordGameList(allVocab);
    setWordGameIndex(0);
    setWordGameScore(0);
    prepareNextWordCard(0, allVocab);
    setState(prev => ({ ...prev, step: 'WORD_GAME' }));
  };

  const handleCheckWordAnswer = (selected: string) => {
    if (!wordGameList[wordGameIndex] || wordGameFeedback) return;

    const correctMeaning = wordGameList[wordGameIndex].meaning;
    const isCorrect = selected === correctMeaning;

    setWordGameFeedback({ isCorrect, selected });
    if (isCorrect) {
      setWordGameScore(prev => prev + 1);
    }

    // Auto advance after short delay
    setTimeout(() => {
      const nextIdx = wordGameIndex + 1;
      if (nextIdx < wordGameList.length) {
        setWordGameIndex(nextIdx);
        prepareNextWordCard(nextIdx, wordGameList);
      } else {
        // End of game
        setWordGameIndex(nextIdx); // To trigger summary
      }
    }, 1500);
  };

  const renderWordGameStep = () => {
    if (wordGameList.length === 0) return null;
    const isFinished = wordGameIndex >= wordGameList.length;

    if (isFinished) {
      return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 text-center pt-20">
          <h2 className="text-3xl font-bold text-slate-800">Word Practice Complete!</h2>
          <p className="text-xl text-slate-600">Your Score: <span className="text-emerald-600 font-bold">{wordGameScore}</span> / {wordGameList.length}</p>
          <button
            onClick={() => setState(prev => ({ ...prev, step: 'LESSON' }))}
            className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all"
          >
            Back to Lesson
          </button>
        </div>
      );
    }

    const currentVocab = wordGameList[wordGameIndex];
    const correctMeaning = currentVocab.meaning;

    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 pb-24">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setState(prev => ({ ...prev, step: 'LESSON' }))}
            className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 shadow-sm transition-colors"
          >
            <i className="fas fa-chevron-left"></i>
          </button>
          <h2 className="text-2xl font-bold text-slate-800">단어 연습 ({wordGameIndex + 1}/{wordGameList.length})</h2>
        </div>

        <div className="max-w-md mx-auto space-y-8">
          {/* Flashcard */}
          <div className="aspect-[4/3] bg-white rounded-[40px] shadow-xl border border-slate-100 flex flex-col items-center justify-center p-8 text-center relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500"></div>
            <span className="text-sm font-bold text-emerald-600 mb-4 tracking-widest uppercase">Word Card</span>
            <h3 className="text-4xl font-black text-slate-800 mb-2">{currentVocab.word}</h3>
            <p className="text-slate-400 font-medium">What does this mean?</p>
          </div>

          {/* Options */}
          <div className="grid grid-cols-1 gap-3">
            {wordGameOptions.map((option, idx) => {
              let btnClass = "bg-white border-2 border-slate-100 text-slate-600 hover:border-indigo-200 hover:bg-indigo-50";
              if (wordGameFeedback) {
                if (option === correctMeaning) {
                  btnClass = "bg-green-500 border-green-500 text-white shadow-lg shadow-green-200 scale-105";
                } else if (option === wordGameFeedback.selected && !wordGameFeedback.isCorrect) {
                  btnClass = "bg-red-500 border-red-500 text-white opacity-50";
                } else {
                  btnClass = "bg-slate-50 border-slate-100 text-slate-300";
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleCheckWordAnswer(option)}
                  disabled={!!wordGameFeedback}
                  className={`p-4 rounded-2xl font-bold text-lg transition-all duration-300 ${btnClass}`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderLessonStep = () => {
    if (!state.lesson) return null;
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setState(prev => ({ ...prev, step: 'INPUT' }))}
              className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors shadow-sm"
            >
              <i className="fas fa-chevron-left"></i>
            </button>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">{state.lesson.title}</h2>
              <p className="text-sm text-slate-500 font-medium">나의 이야기를 바탕으로 구성된 핵심 문장입니다.</p>
            </div>
          </div>
          <button
            onClick={handleSavePDF}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
          >
            <i className="fas fa-file-pdf"></i>
            PDF 저장
          </button>
        </div>

        <div className="grid gap-5">
          {state.lesson.sentences.map((item, idx) => (
            <div
              key={idx}
              className={`p-6 rounded-3xl border-2 transition-all cursor-pointer ${state.selectedSentenceIndex === idx
                ? 'bg-white border-indigo-500 shadow-xl ring-4 ring-indigo-50'
                : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm'
                }`}
              onClick={() => setState(prev => ({ ...prev, selectedSentenceIndex: idx }))}
            >
              <div className="flex justify-between items-start mb-3">
                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${state.selectedSentenceIndex === idx ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                  Sentence {idx + 1}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handlePlayTTS(item.english); }}
                  className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center hover:bg-indigo-100 transition-colors"
                >
                  <i className="fas fa-volume-high"></i>
                </button>
              </div>
              <p className="text-xl font-bold text-slate-800 mb-2 leading-snug">{item.english}</p>
              <p className="text-base text-slate-500 font-medium mb-4">{item.korean}</p>

              {state.selectedSentenceIndex === idx && (
                <div className="mt-6 pt-6 border-t border-slate-50 animate-in fade-in zoom-in-95 duration-300">
                  <div className="mb-5">
                    <span className="text-[10px] font-bold text-slate-400 block mb-2 tracking-widest uppercase">Grammar Point</span>
                    <div className="bg-slate-50 p-4 rounded-2xl text-sm text-slate-700 leading-relaxed border border-slate-100">
                      {item.grammar}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 block mb-2 tracking-widest uppercase">Vocabulary</span>
                    <div className="flex flex-wrap gap-2">
                      {item.vocabulary.map((v, vIdx) => (
                        <span key={vIdx} className="text-xs font-bold px-3 py-2 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100">
                          {v.word}: <span className="font-medium text-indigo-500 ml-1">{v.meaning}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-xl border-t border-slate-100 flex gap-4 max-w-4xl mx-auto z-10 shadow-2xl rounded-t-[32px]">
          <button
            onClick={() => setState(prev => ({ ...prev, step: 'PRACTICE' }))}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2"
          >
            <i className="fas fa-microphone-lines"></i>
            발음 연습하기
          </button>
          <button
            onClick={() => setShowGameSettings(true)}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-amber-200 transition-all flex items-center justify-center gap-2"
          >
            <i className="fas fa-puzzle-piece"></i>
            문장 연습
          </button>
          <button
            onClick={handleStartWordGame}
            className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2"
          >
            <i className="fas fa-layer-group"></i>
            단어 연습
          </button>
          <button
            onClick={handleStartRoleplay}
            className="flex-1 bg-white border-2 border-indigo-600 text-indigo-600 font-bold py-4 rounded-2xl hover:bg-indigo-50 transition-all flex items-center justify-center gap-2"
          >
            <i className="fas fa-comments"></i>
            AI와 대화하기
          </button>
          <button
            onClick={() => {
              fetch('http://localhost:4000/api/pdfs')
                .then(res => res.json())
                .then(data => {
                  setPdfList(data.files || []);
                  setShowPdfList(true);
                })
                .catch(err => alert("PDF 목록을 불러오는데 실패했습니다."));
            }}
            className="w-16 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-4 rounded-2xl transition-all flex items-center justify-center shadow-sm"
          >
            <i className="fas fa-list"></i>
          </button>
        </div>

        {/* PDF List Modal */}
        {showPdfList && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl space-y-6 max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold text-slate-800">학습 기록 (PDF)</h3>
                <button onClick={() => setShowPdfList(false)} className="text-slate-400 hover:text-slate-600">
                  <i className="fas fa-times text-xl"></i>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                {pdfList.length === 0 ? (
                  <p className="text-center text-slate-400 py-10">저장된 PDF가 없습니다.</p>
                ) : (
                  pdfList.map((file, idx) => (
                    <a
                      key={idx}
                      href={`http://localhost:4000/pdfs/${file}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-4 rounded-2xl bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-200 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-rose-500 shadow-sm group-hover:scale-110 transition-transform">
                          <i className="fas fa-file-pdf"></i>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-700 truncate group-hover:text-indigo-700">{file}</p>
                        </div>
                        <i className="fas fa-external-link-alt text-slate-300 group-hover:text-indigo-400"></i>
                      </div>
                    </a>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Game Settings Modal */}
        {showGameSettings && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-[32px] p-8 max-w-sm w-full shadow-2xl space-y-6">
              <div className="text-center">
                <h3 className="text-2xl font-bold text-slate-800 mb-2">난이도 선택</h3>
                <p className="text-slate-500">빈칸의 개수를 선택해주세요.</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map(count => (
                  <button
                    key={count}
                    onClick={() => handleStartSentenceGame(count)}
                    className="aspect-square rounded-2xl bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold text-2xl border-2 border-indigo-100 hover:border-indigo-200 transition-all flex flex-col items-center justify-center gap-1"
                  >
                    <span>{count}</span>
                    <span className="text-[10px] uppercase tracking-wider text-indigo-400">Blanks</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowGameSettings(false)}
                className="w-full py-4 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* Hidden PDF Container */}
        <div ref={pdfRef} style={{ display: 'none', padding: '40px', fontFamily: 'sans-serif' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '20px', color: '#333' }}>{state.lesson.title}</h1>
          <p style={{ marginBottom: '30px', color: '#666' }}>Generated by StorySpeak AI</p>

          {state.lesson.sentences.map((item, idx) => (
            <div key={idx} style={{ marginBottom: '30px', borderBottom: '1px solid #eee', paddingBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px', color: '#4f46e5' }}>Sentence {idx + 1}</h3>
              <p style={{ fontSize: '16px', marginBottom: '5px', fontWeight: 'bold' }}>{item.english}</p>
              <p style={{ fontSize: '14px', color: '#666', marginBottom: '15px' }}>{item.korean}</p>

              <div style={{ backgroundColor: '#f8fafc', padding: '15px', borderRadius: '8px', marginBottom: '10px' }}>
                <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#94a3b8', marginBottom: '5px' }}>GRAMMAR</p>
                <p style={{ fontSize: '14px', color: '#334155' }}>{item.grammar}</p>
              </div>

              <div>
                <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#94a3b8', marginBottom: '5px' }}>VOCABULARY</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {item.vocabulary.map((v, vIdx) => (
                    <span key={vIdx} style={{ fontSize: '12px', padding: '4px 8px', backgroundColor: '#eef2ff', color: '#4338ca', borderRadius: '4px' }}>
                      {v.word}: {v.meaning}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div >
    );
  };

  const renderPracticeStep = () => {
    if (!state.lesson) return null;
    const sentence = state.lesson.sentences[state.selectedSentenceIndex];
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 pb-24">
        <div className="flex items-center gap-4">
          <button
            onClick={() => { setState(prev => ({ ...prev, step: 'LESSON' })); setPronunciationResult(null); }}
            className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 shadow-sm transition-colors"
          >
            <i className="fas fa-chevron-left"></i>
          </button>
          <h2 className="text-2xl font-bold text-slate-800">정확하게 읽어보세요</h2>
        </div>

        <div className="bg-white p-10 rounded-[40px] shadow-xl border border-slate-100 text-center space-y-10">
          <div className="space-y-4">
            <span className="px-4 py-1.5 bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-[0.2em] rounded-full">Practice Mode</span>
            <p className="text-3xl font-black text-slate-800 leading-tight">"{sentence.english}"</p>
            <p className="text-lg text-slate-400 font-medium">{sentence.korean}</p>
          </div>

          <div className="flex flex-col items-center gap-10">
            <button
              onClick={() => handlePlayTTS(sentence.english)}
              className="group flex items-center gap-4 bg-indigo-50 text-indigo-600 px-8 py-4 rounded-2xl hover:bg-indigo-100 transition-all"
            >
              <div className="w-12 h-12 bg-indigo-600 text-white rounded-full flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg shadow-indigo-100">
                <i className="fas fa-play ml-1"></i>
              </div>
              <span className="font-bold text-lg">원어민 발음 듣기</span>
            </button>

            <div className="relative w-full py-10 flex flex-col items-center justify-center border-y border-slate-50 select-none">
              <button
                onClick={handleTogglePracticeRecording}
                className={`w-28 h-28 rounded-full flex items-center justify-center text-white text-4xl shadow-2xl transition-all duration-300 transform ${isRecording
                  ? 'bg-rose-500 scale-125 ring-[12px] ring-rose-100 animate-pulse'
                  : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105 active:scale-90'
                  }`}
                style={{ touchAction: 'none' }}
              >
                <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'}`}></i>
              </button>
              <p className={`text-sm font-bold mt-6 transition-colors duration-200 ${isRecording ? 'text-rose-600' : 'text-slate-400'}`}>
                {isRecording ? "녹음 중입니다... 다시 눌러서 종료하세요" : "버튼을 눌러서 말해보세요"}
              </p>
            </div>
          </div>

          {pronunciationResult && (
            <div className="animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex flex-col items-center mb-8">
                <div className="text-7xl font-black text-indigo-600 mb-2 drop-shadow-sm">{pronunciationResult.score}</div>
                <div className="text-xs font-black text-slate-400 uppercase tracking-[0.3em]">AI Pronunciation Score</div>
              </div>
              <div className="bg-indigo-50/50 p-6 rounded-3xl text-left border-2 border-indigo-100">
                <div className="flex items-center gap-2 mb-2">
                  <i className="fas fa-wand-magic text-indigo-400"></i>
                  <span className="text-xs font-black text-indigo-400 uppercase tracking-widest">AI 피드백</span>
                </div>
                <p className="text-indigo-900 leading-relaxed font-medium whitespace-pre-wrap">{pronunciationResult.feedback}</p>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => {
              const nextIdx = (state.selectedSentenceIndex + 1) % state.lesson!.sentences.length;
              setState(prev => ({ ...prev, selectedSentenceIndex: nextIdx }));
              setPronunciationResult(null);
            }}
            className="bg-white border-2 border-slate-200 py-4 rounded-2xl font-bold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
          >
            다음 문장 연습
          </button>
          <button
            onClick={handleStartRoleplay}
            className="bg-indigo-600 py-4 rounded-2xl font-bold text-white shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
          >
            <i className="fas fa-comments"></i>
            롤플레이 시작
          </button>
        </div>
      </div>
    );
  };

  const renderRoleplayStep = () => {
    return (
      <div className="flex flex-col h-[calc(100vh-160px)] animate-in fade-in slide-in-from-right-4 duration-500">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={handleEndRoleplay}
            className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors shadow-sm"
          >
            <i className="fas fa-chevron-left"></i>
          </button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-slate-800">AI 실시간 대화</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`w-2.5 h-2.5 rounded-full ${isRoleplayMicOn ? 'bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.6)]' : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'}`}></span>
              <span className={`text-[10px] font-black uppercase tracking-widest ${isRoleplayMicOn ? 'text-rose-600' : 'text-green-600'}`}>
                {isRoleplayMicOn ? 'AI is Listening...' : 'Live Connected'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 p-6 bg-slate-100/50 rounded-[40px] border-2 border-slate-200 shadow-inner mb-6 custom-scrollbar">
          {roleplayMessages.length === 0 && !isLoading && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4 opacity-60">
              <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center text-3xl shadow-sm">
                <i className="fas fa-comment-dots"></i>
              </div>
              <p className="font-bold text-lg">아래 마이크를 켜고 AI에게 인사를 건네보세요!</p>
            </div>
          )}
          {roleplayMessages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
              <div className={`max-w-[85%] p-5 rounded-3xl shadow-md ${msg.role === 'user'
                ? 'bg-indigo-600 text-white rounded-tr-none'
                : 'bg-white text-slate-800 border border-slate-100 rounded-tl-none'
                }`}>
                <p className="text-base font-medium leading-relaxed">{msg.text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-xl flex items-center justify-between">
          <button
            onClick={handleToggleRoleplayMic}
            className="flex items-center gap-4 group flex-1"
          >
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl shadow-inner transition-all duration-300 ${isRoleplayMicOn ? 'bg-rose-500 text-white scale-110 shadow-rose-100' : 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100'
              }`}>
              <i className={`fas ${isRoleplayMicOn ? 'fa-microphone' : 'fa-microphone-slash'}`}></i>
            </div>
            <div className="text-left">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Microphone</div>
              <div className={`text-lg font-black transition-colors ${isRoleplayMicOn ? 'text-rose-600' : 'text-indigo-600'}`}>
                {isRoleplayMicOn ? 'AI가 듣고 있습니다' : '눌러서 마이크 켜기'}
              </div>
            </div>
          </button>
          <button
            onClick={handleEndRoleplay}
            className="px-8 py-3 bg-slate-50 text-slate-400 rounded-2xl font-bold hover:bg-rose-50 hover:text-rose-600 transition-all border border-slate-100"
          >
            종료하기
          </button>
        </div>
      </div>
    );
  };

  const [showIntro, setShowIntro] = useState(true);

  // ... (existing state)

  const renderIntro = () => (
    <div className="fixed inset-0 bg-indigo-600 z-50 flex flex-col items-center justify-center p-6 animate-in fade-in duration-500">
      <div className="bg-white p-10 rounded-[40px] shadow-2xl max-w-md w-full text-center space-y-8 animate-in zoom-in-95 duration-500 delay-150">
        <div className="w-24 h-24 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-4xl mx-auto shadow-inner">
          <i className="fas fa-book-open"></i>
        </div>
        <div className="space-y-4">
          <h1 className="text-3xl font-black text-slate-800 leading-tight">
            영어정복!!<br />
            <span className="text-indigo-600">하루일과로 일기처럼</span>
          </h1>
          <p className="text-xl text-slate-500 font-bold">
            5문장 학습하기
          </p>
        </div>
        <button
          onClick={() => setShowIntro(false)}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xl font-bold py-5 rounded-2xl shadow-lg shadow-indigo-200 transition-all transform hover:scale-105 active:scale-95"
        >
          시작하기
        </button>
      </div>
    </div>
  );

  return (
    <Layout>
      {showIntro && renderIntro()}
      {isLoading && <LoadingOverlay message={loadingMessage} />}
      <div className="max-w-2xl mx-auto">
        {state.step === 'INPUT' && renderInputStep()}
        {state.step === 'LESSON' && renderLessonStep()}
        {state.step === 'PRACTICE' && renderPracticeStep()}
        {state.step === 'ROLEPLAY' && renderRoleplayStep()}
        {state.step === 'SENTENCE_GAME' && renderSentenceGameStep()}
        {state.step === 'WORD_GAME' && renderWordGameStep()}
      </div>
    </Layout>
  );
};

export default App;
