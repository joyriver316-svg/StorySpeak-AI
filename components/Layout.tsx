
import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
}

export const Layout: React.FC<LayoutProps> = ({ children, title = "StorySpeak AI" }) => {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
              <i className="fas fa-book-open text-sm"></i>
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
              {title}
            </h1>
          </div>
          <div className="text-xs text-slate-500 font-medium bg-slate-100 px-3 py-1 rounded-full">
            BETA
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 md:p-6 pb-24">
        {children}
      </main>
      <footer className="bg-white border-t border-slate-200 p-4 text-center text-slate-400 text-sm">
        © 2025 StorySpeak AI. All rights reserved.
      </footer>
    </div>
  );
};
