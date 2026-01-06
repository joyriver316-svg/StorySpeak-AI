
import { LearningLevel, LessonData } from "../types";

// Mock Data
const MOCK_LESSON: LessonData = {
  title: "A Day at the Park (Mock)",
  sentences: [
    {
      english: "The sun is shining brightly today.",
      korean: "오늘은 해가 밝게 빛나고 있습니다.",
      grammar: "Present continuous tense for current action.",
      vocabulary: [
        { word: "shining", meaning: "빛나는" },
        { word: "brightly", meaning: "밝게" }
      ]
    },
    {
      english: "Children are playing on the swings.",
      korean: "아이들이 그네를 타고 놀고 있습니다.",
      grammar: "Plural subject 'Children' with 'are'.",
      vocabulary: [
        { word: "children", meaning: "아이들" },
        { word: "swings", meaning: "그네" }
      ]
    }
  ]
};

export const generateLesson = async (story: string, level: LearningLevel): Promise<LessonData> => {
  console.log(`[MOCK] generateLesson called with story: "${story}", level: ${level}`);
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  return MOCK_LESSON;
};

export const generateSpeech = async (text: string): Promise<string> => {
  console.log(`[MOCK] generateSpeech called with text: "${text}"`);
  await new Promise(resolve => setTimeout(resolve, 500));
  // Return a dummy base64 string (short silent audio or just a placeholder)
  // This is a very short silent MP3 base64
  return "UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
};

export const transcribeAudio = async (audioBase64: string, mimeType: string): Promise<string> => {
  console.log(`[MOCK] transcribeAudio called. MimeType: ${mimeType}`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  return "이것은 테스트용 음성 인식 결과입니다. 마이크가 잘 작동하고 있네요!";
};

export const evaluatePronunciation = async (originalText: string, userAudioBase64: string, mimeType: string): Promise<{ score: number, feedback: string }> => {
  console.log(`[MOCK] evaluatePronunciation called for text: "${originalText}"`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  return {
    score: 85,
    feedback: "전반적으로 훌륭합니다! 'shining' 발음에서 'sh' 소리를 조금 더 부드럽게 내보세요."
  };
};
