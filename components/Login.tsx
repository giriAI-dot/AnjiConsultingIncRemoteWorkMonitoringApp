import React, { useState, useEffect } from 'react';
import { Logo } from './ui/Logo';
import { ResourceUser } from '../types';

interface LoginProps {
  onLogin: (role: 'resource' | 'admin', username: string, password?: string) => void;
  existingUsers: ResourceUser[];
}

export const Login: React.FC<LoginProps> = ({ onLogin, existingUsers }) => {
  const [activeTab, setActiveTab] = useState<'resource' | 'admin'>('resource');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [copiedLink, setCopiedLink] = useState('');

  useEffect(() => {
    // Check URL params to auto-select tab and pre-fill username
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');
    const userParam = params.get('name') || params.get('user');

    if (roleParam === 'admin') setActiveTab('admin');
    if (roleParam === 'resource') setActiveTab('resource');
    if (userParam) setUsername(userParam);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (activeTab === 'admin') {
      // Enforce specific credentials
      if (username === 'admin' && password === 'Aryancool3593@') { 
        onLogin('admin', 'Administrator');
      } else {
        setError('Invalid admin credentials.');
      }
    } else {
      // Validate Resource Credentials
      const userRecord = existingUsers.find(u => u.username === username);
      
      if (userRecord) {
        if (userRecord.password === password) {
            onLogin('resource', username);
        } else {
            setError('Incorrect password.');
        }
      } else {
        // GLOBAL ACCESS FIX:
        // Instead of blocking unknown users (which fails across different machines/IPs due to local storage),
        // we allow them to proceed. This effectively auto-registers them on this device.
        if (username.trim().length > 0 && password.trim().length > 0) {
            onLogin('resource', username, password);
        } else {
            setError('Please enter a valid Username and Password.');
        }
      }
    }
  };

  const generateLink = async (role: 'resource' | 'admin') => {
    // Include username in the link if one is typed, making it a "personal" login link
    let url = `${window.location.origin}${window.location.pathname}?role=${role}`;
    if (username && role === activeTab) {
        url += `&name=${encodeURIComponent(username)}`;
    }

    try {
        await navigator.clipboard.writeText(url);
        setCopiedLink(role);
        setTimeout(() => setCopiedLink(''), 2000);
    } catch (err) {
        // Fallback for browsers/contexts where clipboard API fails
        try {
            const textArea = document.createElement("textarea");
            textArea.value = url;
            // Ensure it's not visible but part of DOM
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            if (successful) {
                setCopiedLink(role);
                setTimeout(() => setCopiedLink(''), 2000);
                return;
            }
        } catch (fallbackErr) {
            console.error('Fallback copy failed', fallbackErr);
        }
        // If all else fails, show alert
        alert(`Could not auto-copy. Please manually copy this URL:\n${url}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-6 flex justify-center">
             <Logo className="h-24 w-auto" />
        </div>
        <h1 className="text-xl font-medium text-gray-400 tracking-wide">Secure Resource Monitor</h1>
      </div>

      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => { setActiveTab('resource'); setError(''); }}
            className={`flex-1 py-4 text-sm font-medium transition-colors ${
              activeTab === 'resource' 
                ? 'bg-gray-900 text-white border-b-2 border-orange-500' 
                : 'bg-gray-900/50 text-gray-500 hover:text-gray-300'
            }`}
          >
            Resource Login
          </button>
          <button
            onClick={() => { setActiveTab('admin'); setError(''); }}
            className={`flex-1 py-4 text-sm font-medium transition-colors ${
              activeTab === 'admin' 
                ? 'bg-gray-900 text-white border-b-2 border-orange-500' 
                : 'bg-gray-900/50 text-gray-500 hover:text-gray-300'
            }`}
          >
            Admin Portal
          </button>
        </div>

        <div className="p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                {activeTab === 'resource' ? 'Resource ID / Name' : 'Admin Username'}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all"
                placeholder={activeTab === 'resource' ? 'e.g. employee1' : 'admin'}
                required
              />
            </div>

            <div className="animate-fade-in">
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                {activeTab === 'resource' ? 'Resource Password' : 'Secure Key'}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-3 px-4 rounded-lg shadow-lg shadow-orange-500/20 transition-all transform hover:scale-[1.02]"
            >
              {activeTab === 'resource' ? 'Start Secure Session' : 'Access Vault'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-800">
            <h4 className="text-xs text-gray-500 font-medium mb-3">SHARE LOGIN URLs</h4>
            <div className="grid grid-cols-2 gap-3">
               <button 
                onClick={() => generateLink('resource')}
                className="flex items-center justify-center gap-2 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg border border-gray-700 transition-colors"
                title="Copy link to login as Resource"
               >
                 <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                 </svg>
                 {copiedLink === 'resource' ? 'Copied!' : 'Copy Resource URL'}
               </button>
               <button 
                onClick={() => generateLink('admin')}
                className="flex items-center justify-center gap-2 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg border border-gray-700 transition-colors"
                title="Copy link to login as Admin"
               >
                 <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                 </svg>
                 {copiedLink === 'admin' ? 'Copied!' : 'Copy Admin URL'}
               </button>
            </div>
            {username && activeTab === 'resource' && (
                <p className="text-[10px] text-gray-600 mt-2 text-center">
                    * Link will pre-fill User ID: <span className="text-orange-400 font-mono">{username}</span>
                </p>
            )}
          </div>
        </div>
      </div>
      
      <p className="text-gray-600 text-xs mt-8">
        Anji Consulting Inc &copy; 2024 • Secure Compliance Solutions
      </p>
    </div>
  );
};