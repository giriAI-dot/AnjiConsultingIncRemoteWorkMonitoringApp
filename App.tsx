import React, { useState, useEffect } from 'react';
import { Header } from './components/ui/Header';
import { LiveMonitor } from './components/LiveMonitor';
import { Vault } from './components/Vault';
import { Login } from './components/Login';
import { RecordedSession, SessionLog, ResourceUser } from './types';

const App: React.FC = () => {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<'resource' | 'admin' | null>(null);
  const [username, setUsername] = useState('');

  // Data State
  const [sessions, setSessions] = useState<RecordedSession[]>([]);
  
  // User Management State (Persisted in localStorage for demo purposes)
  const [resourceUsers, setResourceUsers] = useState<ResourceUser[]>(() => {
    const saved = localStorage.getItem('sw_users');
    return saved ? JSON.parse(saved) : [
      // Default demo user
      { id: 'u_1', username: 'employee1', password: 'password', createdAt: Date.now() }
    ];
  });

  useEffect(() => {
    localStorage.setItem('sw_users', JSON.stringify(resourceUsers));
  }, [resourceUsers]);

  const handleLogin = (role: 'resource' | 'admin', name: string) => {
    setIsAuthenticated(true);
    setUserRole(role);
    setUsername(name);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUserRole(null);
    setUsername('');
  };

  const handleCreateUser = (newUser: ResourceUser) => {
    const userWithId = { ...newUser, id: crypto.randomUUID() };
    setResourceUsers(prev => [...prev, userWithId]);
  };

  const handleUpdateUser = (updatedUser: ResourceUser) => {
    const oldUser = resourceUsers.find(u => u.id === updatedUser.id);
    setResourceUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));

    // Update session references if username changed
    if (oldUser && oldUser.username !== updatedUser.username) {
        setSessions(prev => prev.map(s => s.resourceId === oldUser.username ? { ...s, resourceId: updatedUser.username } : s));
    }
    
    // If the currently logged in admin somehow updated themselves (not possible in this flow but good practice) or if we were editing the current user
    if (username === oldUser?.username) {
        setUsername(updatedUser.username);
    }
  };

  const handleSessionComplete = (duration: number, logs: SessionLog[], videoUrl?: string) => {
    // Simulate creating a secure record
    const newSession: RecordedSession = {
      id: crypto.randomUUID(),
      resourceId: username,
      startTime: Date.now() - (duration * 1000),
      duration: duration,
      status: 'secure',
      // Simulate file size based on rough bitrate estimate
      fileSize: `${Math.max(1, Math.floor(duration / 60 * 2.5))} MB`, 
      // Expires in 24 hours
      expiryTime: Date.now() + (24 * 60 * 60 * 1000),
      logs: logs,
      videoUrl: videoUrl
    };
    
    setSessions(prev => [newSession, ...prev]);
  };

  const handleDeleteSession = (sessionId: string) => {
    setSessions(prev => prev.filter(session => session.id !== sessionId));
  };

  // 1. Show Login if not authenticated
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} existingUsers={resourceUsers} />;
  }

  // 2. Main App Layout
  return (
    <div className="min-h-screen bg-gray-950 pb-12">
      <Header 
        userRole={userRole} 
        username={username} 
        onLogout={handleLogout} 
      />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Resource View: Monitoring Dashboard */}
        {userRole === 'resource' && (
            <>
                <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-4 mb-8 flex items-start gap-4 animate-fade-in">
                    <div className="p-2 bg-indigo-500/20 rounded-lg">
                        <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <div>
                        <h4 className="text-white font-medium">Compliance Monitoring Active</h4>
                        <p className="text-gray-400 text-sm mt-1">
                            Welcome, {username}. This session captures screen and audio data for compliance. 
                            Data is encrypted and automatically purged after 24 hours.
                        </p>
                    </div>
                </div>

                <LiveMonitor username={username} onSessionComplete={handleSessionComplete} />
                
                {/* Employee can see their own session history at the bottom */}
                <Vault 
                    sessions={sessions.filter(s => s.resourceId === username)} 
                    role="employee" 
                    onDelete={handleDeleteSession} 
                />
            </>
        )}

        {/* Admin View: Full Vault Access */}
        {userRole === 'admin' && (
            <div className="animate-fade-in">
                <div className="mb-8 flex justify-between items-end">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Administrator Portal</h2>
                        <p className="text-gray-400">Audit employee sessions and manage secure storage.</p>
                    </div>
                </div>
                <Vault 
                  sessions={sessions} 
                  role="admin" 
                  onDelete={handleDeleteSession} 
                  onCreateUser={handleCreateUser}
                  users={resourceUsers}
                  onUpdateUser={handleUpdateUser}
                />
            </div>
        )}

      </main>
    </div>
  );
};

export default App;