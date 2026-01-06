
export enum LearningLevel {
  BEGINNER = 'Beginner',
  INTERMEDIATE = 'Intermediate',
  ADVANCED = 'Advanced'
}

export interface VocabularyItem {
  word: string;
  meaning: string;
}

export interface SentenceItem {
  english: string;
  korean: string;
  grammar: string;
  vocabulary: VocabularyItem[];
}

export interface LessonData {
  title: string;
  sentences: SentenceItem[];
}

export interface AppState {
  step: 'INPUT' | 'LESSON' | 'PRACTICE' | 'ROLEPLAY' | 'SENTENCE_GAME' | 'WORD_GAME';
  storyInput: string;
  level: LearningLevel;
  lesson: LessonData | null;
  selectedSentenceIndex: number;
}
