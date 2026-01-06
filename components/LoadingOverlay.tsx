
import React, { useState, useEffect } from 'react';

const defaultMessages = [
  "잠시만 기다려주세요...",
  "데이터를 처리하고 있습니다...",
  "거의 다 되었습니다!"
];

interface LoadingOverlayProps {
  message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ message }) => {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (message) return; // 커스텀 메시지가 있으면 인터벌 중단
    const interval = setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % defaultMessages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [message]);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="bg-white p-10 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm w-full border border-slate-100">
        <div className="relative w-20 h-20 mb-8">
          <div className="absolute inset-0 border-4 border-indigo-50 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
        </div>
        <p className="text-xl font-bold text-slate-800 mb-2">
          {message ? "처리 중" : "잠시만 기다려주세요"}
        </p>
        <p className="text-indigo-600 font-medium animate-pulse">
          {message || defaultMessages[msgIndex]}
        </p>
      </div>
    </div>
  );
};
