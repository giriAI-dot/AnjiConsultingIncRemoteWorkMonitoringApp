import React from 'react';
import { Logo } from './Logo';

interface HeaderProps {
  userRole: 'resource' | 'admin' | null;
  username: string;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ userRole, username, onLogout }) => {
  return (
    <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Logo className="h-12 w-auto" />
          <div className="hidden md:block border-l border-gray-700 pl-4 ml-2">
            <h1 className="text-lg font-bold text-white tracking-tight leading-none">Resource Monitor</h1>
            <p className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">
                {userRole === 'admin' ? 'Administrator Vault' : 'Secure Session Active'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-gray-800/50 px-3 py-1.5 rounded-lg border border-gray-800">
                <div className={`w-2 h-2 rounded-full ${userRole === 'admin' ? 'bg-orange-500' : 'bg-green-500'}`}></div>
                <span className="text-sm text-gray-300 font-medium">{username}</span>
                <span className="text-xs text-gray-500 uppercase border-l border-gray-700 pl-2 ml-2">
                    {userRole === 'admin' ? 'Admin' : 'Resource'}
                </span>
            </div>

            <button 
                onClick={onLogout}
                className="text-gray-400 hover:text-white p-2 hover:bg-gray-800 rounded-lg transition-colors"
                title="Logout"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
            </button>
        </div>
      </div>
    </header>
  );
};