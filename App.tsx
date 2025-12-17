import React, { useState, useEffect } from 'react';
import { Header } from './components/ui/Header';
import { LiveMonitor } from './components/LiveMonitor';
import { Vault } from './components/Vault';
import { Login } from './components/Login';
import { RecordedSession, SessionLog, ResourceUser } from './types';

// Robust UUID generator for non-secure contexts (http/lan)
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const App: React.FC = () => {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<'resource' | 'admin' | null>(null);
  const [username, setUsername] = useState('');

  // Data State
  const [sessions, setSessions] = useState<RecordedSession[]>(() => {
    try {
      const saved = localStorage.getItem('sw_sessions');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("Failed to load sessions", e);
      return [];
    }
  });
  
  // User Management State (Persisted in localStorage)
  const [resourceUsers, setResourceUsers] = useState<ResourceUser[]>(() => {
    try {
      const saved = localStorage.getItem('sw_users');
      return saved ? JSON.parse(saved) : [
        // Default demo user - only used if absolutely no data exists
        { id: 'u_1', username: 'employee1', password: 'password', createdAt: Date.now() }
      ];
    } catch (e) {
      console.warn("Failed to load users", e);
      return [{ id: 'u_1', username: 'employee1', password: 'password', createdAt: Date.now() }];
    }
  });

  useEffect(() => {
    localStorage.setItem('sw_users', JSON.stringify(resourceUsers));
  }, [resourceUsers]);

  useEffect(() => {
    // Persist sessions metadata. 
    // We strip videoUrl AND thumbnails to avoid saving large blobs/strings in LocalStorage.
    // Full logs with thumbnails should be loaded from IndexedDB in components that need them.
    const sessionsToSave = sessions.map(s => {
      const { videoUrl, logs, ...rest } = s;
      // Strip thumbnails from logs for lightweight storage
      const lightLogs = logs.map(log => {
          const { thumbnail, ...logRest } = log;
          return logRest;
      });
      return { ...rest, logs: lightLogs };
    });
    localStorage.setItem('sw_sessions', JSON.stringify(sessionsToSave));
  }, [sessions]);

  const handleLogin = (role: 'resource' | 'admin', name: string, password?: string) => {
    setIsAuthenticated(true);
    setUserRole(role);
    setUsername(name);

    // GLOBAL ACCESS: Auto-register new user if they don't exist in local storage.
    // This allows employees in different locations (e.g. India) to login without
    // manual pre-configuration on that specific device.
    if (role === 'resource') {
        const exists = resourceUsers.find(u => u.username === name);
        if (!exists) {
            const newUser: ResourceUser = {
                id: generateUUID(),
                username: name,
                password: password || 'default-secure', // Use provided password or fallback
                createdAt: Date.now()
            };
            setResourceUsers(prev => [...prev, newUser]);
        }
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUserRole(null);
    setUsername('');
  };

  const handleCreateUser = (newUser: ResourceUser) => {
    const userWithId = { ...newUser, id: generateUUID() };
    setResourceUsers(prev => [...prev, userWithId]);
  };

  const handleUpdateUser = (updatedUser: ResourceUser) => {
    const oldUser = resourceUsers.find(u => u.id === updatedUser.id);
    setResourceUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));

    // Update session references if username changed
    if (oldUser && oldUser.username !== updatedUser.username) {
        setSessions(prev => prev.map(s => s.resourceId === oldUser.username ? { ...s, resourceId: updatedUser.username } : s));
    }
    
    // If the currently logged in admin somehow updated themselves
    if (username === oldUser?.username) {
        setUsername(updatedUser.username);
    }
  };

  const handleExportResources = () => {
    const dataStr = JSON.stringify(resourceUsers, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'resource_config.json';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImportResources = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const imported = JSON.parse(event.target?.result as string);
            if (Array.isArray(imported)) {
                setResourceUsers(imported);
                alert("Resources imported successfully.");
            } else {
                alert("Invalid format: File must contain a JSON array of users.");
            }
        } catch (err) {
            console.error("Import failed", err);
            alert("Invalid configuration file.");
        }
    };
    reader.readAsText(file);
  };

  const handleSessionComplete = (sessionId: string, duration: number, logs: SessionLog[], videoUrl?: string) => {
    // sessionId passed from LiveMonitor matches what was used for DB storage.
    
    const newSession: RecordedSession = {
      id: sessionId, 
      resourceId: username,
      startTime: Date.now() - (duration * 1000),
      duration: duration,
      status: 'secure',
      // Simulate file size based on rough bitrate estimate
      fileSize: `${Math.max(1, Math.floor(duration / 60 * 2.5))} MB`, 
      // Expires in 3 days
      expiryTime: Date.now() + (3 * 24 * 60 * 60 * 1000),
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
                            Data is encrypted and automatically purged after 3 days.
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
                  onExportUsers={handleExportResources}
                  onImportUsers={handleImportResources}
                />
            </div>
        )}

      </main>
    </div>
  );
};

export default App;