import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RecordedSession, ResourceUser, SessionLog } from '../types';
import { getVideoFromDB, getLogsFromDB } from '../services/db';

interface VaultProps {
  sessions: RecordedSession[];
  role?: 'admin' | 'employee';
  onDelete: (sessionId: string) => void;
  onCreateUser?: (newUser: ResourceUser) => void;
  users?: ResourceUser[];
  onUpdateUser?: (updatedUser: ResourceUser) => void;
  onExportUsers?: () => void;
  onImportUsers?: (file: File) => void;
}

interface ActivitySegment {
  startTime: number;
  endTime: number;
  duration: number;
  category: string;
  screenshot?: string;
  count: number;
}

export const Vault: React.FC<VaultProps> = ({ 
  sessions, 
  role = 'admin', 
  onDelete, 
  onCreateUser,
  users = [],
  onUpdateUser,
  onExportUsers,
  onImportUsers
}) => {
  const [now, setNow] = useState(Date.now());
  const [selectedSession, setSelectedSession] = useState<RecordedSession | null>(null);
  const [decryptionStatus, setDecryptionStatus] = useState<'locked' | 'decrypting' | 'unlocked'>('locked');
  const [videoLoading, setVideoLoading] = useState(false);
  
  // View State
  const [viewMode, setViewMode] = useState<'sessions' | 'users' | 'analytics'>('sessions');

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Analytics State
  const [selectedAnalyticsUser, setSelectedAnalyticsUser] = useState<string>('all');
  const [analysisSessionId, setAnalysisSessionId] = useState<string | null>(null);
  const [detailedAnalysis, setDetailedAnalysis] = useState<{session: RecordedSession, segments: ActivitySegment[]} | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);

  // Create/Edit User Modal State
  const [showUserModal, setShowUserModal] = useState(false);
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userFormUsername, setUserFormUsername] = useState('');
  const [userFormPassword, setUserFormPassword] = useState('');
  const [formSuccess, setFormSuccess] = useState(false);

  const importInputRef = useRef<HTMLInputElement>(null);

  // Update "now" every minute
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Async Effect to Load Detailed Analysis Data
  useEffect(() => {
    if (!analysisSessionId) {
        setDetailedAnalysis(null);
        return;
    }

    const loadData = async () => {
        setIsLoadingAnalysis(true);
        try {
            const session = sessions.find(s => s.id === analysisSessionId);
            if (!session) {
                setDetailedAnalysis(null);
                return;
            }

            // Try to get full logs with thumbnails from DB to restore visual context
            const dbLogs = await getLogsFromDB(session.id);
            const logsToUse = (dbLogs && dbLogs.length > 0) ? dbLogs : session.logs;

            if (!logsToUse || logsToUse.length === 0) {
                setDetailedAnalysis({ session, segments: [] });
                return;
            }

            // Group consecutive logs into segments
            const segments: ActivitySegment[] = [];
            let currentSegment: ActivitySegment | null = null;

            // Sort logs by time
            const sortedLogs = [...logsToUse].sort((a,b) => a.timestamp - b.timestamp);

            sortedLogs.forEach((log) => {
                const logDuration = log.category === 'Idle' ? 60 : 15;
                
                if (!currentSegment) {
                    currentSegment = {
                        startTime: log.timestamp,
                        endTime: log.timestamp + logDuration * 1000,
                        duration: logDuration,
                        category: log.category,
                        screenshot: log.thumbnail, // First thumbnail
                        count: 1
                    };
                } else {
                    // Check continuity (within 2 mins) and same category
                    const timeGap = log.timestamp - currentSegment.endTime;
                    if (timeGap < 120000 && log.category === currentSegment.category) {
                        currentSegment.endTime = log.timestamp + logDuration * 1000;
                        currentSegment.duration += logDuration;
                        currentSegment.count += 1;
                        // Prioritize preserving a valid screenshot if we have one
                        if (!currentSegment.screenshot && log.thumbnail) {
                            currentSegment.screenshot = log.thumbnail;
                        }
                    } else {
                        segments.push(currentSegment);
                        currentSegment = {
                            startTime: log.timestamp,
                            endTime: log.timestamp + logDuration * 1000,
                            duration: logDuration,
                            category: log.category,
                            screenshot: log.thumbnail,
                            count: 1
                        };
                    }
                }
            });
            if (currentSegment) segments.push(currentSegment);

            setDetailedAnalysis({ session, segments });
        } catch (e) {
            console.error("Failed to analyze session", e);
        } finally {
            setIsLoadingAnalysis(false);
        }
    };

    loadData();
  }, [analysisSessionId, sessions]);

  // Effect to load video when session is selected and no videoUrl is present
  useEffect(() => {
    if (selectedSession && !selectedSession.videoUrl) {
      setVideoLoading(true);
      getVideoFromDB(selectedSession.id)
        .then((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            setSelectedSession((prev) => prev ? { ...prev, videoUrl: url } : null);
          }
        })
        .catch((e) => console.error("Video fetch failed", e))
        .finally(() => setVideoLoading(false));
    } else {
      setVideoLoading(false);
    }
  }, [selectedSession?.id]); // Only re-run if ID changes

  const getRemainingTime = (expiry: number) => {
    const diff = expiry - now;
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const formatDuration = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return `${h}h ${m}m`;
  };

  const getPercentage = (part: number, total: number) => {
      if (total === 0) return 0;
      return Math.round((part / total) * 100);
  };

  const activeSessions = sessions.filter(s => {
      const isVisibleForRole = role === 'admin' ? true : (s.status !== 'expired' && s.expiryTime > now);
      if (!isVisibleForRole) return false;
      if (searchQuery.trim() === '') return true;
      const query = searchQuery.toLowerCase();
      return (
          s.resourceId.toLowerCase().includes(query) || 
          s.id.toLowerCase().includes(query)
      );
  });

  const handleOpenAudit = (session: RecordedSession) => {
    setSelectedSession(session);
    setDecryptionStatus('locked');
  };

  const handleDecrypt = () => {
    setDecryptionStatus('decrypting');
    setTimeout(() => {
      setDecryptionStatus('unlocked');
    }, 2000);
  };

  // --- Analytics Logic (Overview) ---
  const filteredSessionsForAnalytics = useMemo(() => {
      return sessions.filter(s => {
        if (selectedAnalyticsUser === 'all') return true;
        return s.resourceId === selectedAnalyticsUser;
    });
  }, [sessions, selectedAnalyticsUser]);

  const analyticsOverview = useMemo(() => {
    let totalDurationSeconds = 0;
    let cameraOnSeconds = 0;
    const categoryStats: Record<string, number> = {
        'Coding': 0, 'Study': 0, 'Training': 0, 'Meeting': 0, 'Work': 0, 'Idle': 0, 'Other': 0
    };

    filteredSessionsForAnalytics.forEach(session => {
        totalDurationSeconds += session.duration;
        session.logs.forEach(log => {
             const duration = log.category === 'Idle' ? 60 : 15;
             if (log.isCameraOn) cameraOnSeconds += duration;
             
             const key = Object.keys(categoryStats).find(k => k.toLowerCase() === (log.category || '').toLowerCase()) || 'Other';
             categoryStats[key] += duration;
        });
    });

    cameraOnSeconds = Math.min(cameraOnSeconds, totalDurationSeconds);
    return {
        totalDuration: totalDurationSeconds,
        cameraDuration: cameraOnSeconds,
        categories: categoryStats,
        sessionCount: filteredSessionsForAnalytics.length
    };
  }, [filteredSessionsForAnalytics]);


  // User Form Handling
  const handleUserFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userFormUsername || !userFormPassword) return;

    if (isEditingUser && onUpdateUser && editingUserId) {
        const original = users.find(u => u.id === editingUserId);
        if (original) {
            onUpdateUser({ ...original, username: userFormUsername, password: userFormPassword });
        }
    } else if (!isEditingUser && onCreateUser) {
        onCreateUser({
            id: '', 
            username: userFormUsername,
            password: userFormPassword,
            createdAt: Date.now()
        });
    }

    setFormSuccess(true);
    setTimeout(() => {
        setFormSuccess(false);
        setShowUserModal(false);
    }, 1000);
  };

  const handleOpenCreateUser = () => {
    setIsEditingUser(false);
    setEditingUserId(null);
    setUserFormUsername('');
    setUserFormPassword('');
    setShowUserModal(true);
  };

  const handleOpenEditUser = (user: ResourceUser) => {
    setIsEditingUser(true);
    setEditingUserId(user.id);
    setUserFormUsername(user.username);
    setUserFormPassword(user.password);
    setShowUserModal(true);
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onImportUsers) {
        onImportUsers(file);
    }
    if (e.target) e.target.value = '';
  };

  return (
    <div className={`${role === 'employee' ? 'mt-12 border-t border-gray-800 pt-8' : 'space-y-6'}`}>
      
      {/* Admin Dashboard Stats & Tabs */}
      {role === 'admin' && (
        <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
                    <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wider">Active Sessions</h3>
                    <p className="text-3xl font-bold text-white mt-2">{activeSessions.length}</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
                    <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wider">Total Storage Used</h3>
                    <p className="text-3xl font-bold text-white mt-2">
                    {activeSessions.reduce((acc, curr) => acc + parseInt(curr.fileSize), 0)} MB
                    </p>
                </div>
                <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl relative overflow-hidden">
                    <div className="relative z-10">
                    <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wider">Registered Resources</h3>
                    <div className="flex items-baseline gap-2 mt-2">
                        <p className="text-3xl font-bold text-white">{users.length}</p>
                        <span className="text-xs text-gray-500">active accounts</span>
                    </div>
                    </div>
                </div>
            </div>

            <div className="flex border-b border-gray-800 mb-6">
                <button 
                    onClick={() => { setViewMode('sessions'); setSearchQuery(''); setAnalysisSessionId(null); }}
                    className={`pb-3 px-4 text-sm font-medium transition-colors ${viewMode === 'sessions' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-500 hover:text-white'}`}
                >
                    Session Vault
                </button>
                <button 
                    onClick={() => setViewMode('users')}
                    className={`pb-3 px-4 text-sm font-medium transition-colors ${viewMode === 'users' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-500 hover:text-white'}`}
                >
                    Resource Management
                </button>
                <button 
                    onClick={() => setViewMode('analytics')}
                    className={`pb-3 px-4 text-sm font-medium transition-colors ${viewMode === 'analytics' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-500 hover:text-white'}`}
                >
                    Analytics & Insights
                </button>
            </div>
        </>
      )}

      {/* View: Sessions */}
      {(role === 'employee' || viewMode === 'sessions') && (
        <>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${role === 'admin' ? 'bg-indigo-600/20' : 'bg-gray-800'}`}>
                            <svg className={`w-6 h-6 ${role === 'admin' ? 'text-indigo-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        {role === 'admin' ? 'Session Recordings' : 'My Session History'}
                    </h2>
                </div>
                <span className="text-sm text-gray-500 bg-gray-900 px-3 py-1 rounded-full border border-gray-800 hidden sm:block">
                    {role === 'admin' ? (
                        <>Retention: <span className="text-gray-300 font-semibold">3 Days</span></>
                    ) : (
                        <>Auto-deletion: <span className="text-gray-300 font-semibold">3 Days</span></>
                    )}
                </span>
            </div>

            <div className="mb-4 relative animate-fade-in">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 text-gray-300 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block pl-10 p-2.5 placeholder-gray-500 transition-colors"
                    placeholder="Search sessions by Resource ID or Session ID..."
                />
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl animate-fade-in">
                <div className="grid grid-cols-12 gap-4 p-4 border-b border-gray-800 bg-gray-800/50 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <div className="col-span-3">Resource / Session ID</div>
                    <div className="col-span-2">Date Recorded</div>
                    <div className="col-span-2">Duration</div>
                    <div className="col-span-2">Size</div>
                    <div className="col-span-2">Expires In</div>
                    <div className="col-span-1 text-right">Actions</div>
                </div>
                
                {activeSessions.length === 0 ? (
                    <div className="p-16 text-center">
                        <p className="text-lg font-medium text-white">No Recordings Available</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-800">
                        {activeSessions.map((session) => (
                            <div key={session.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-gray-800/30 transition-colors group">
                                <div className="col-span-3 flex flex-col justify-center">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${session.status === 'secure' ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                                        <span className="text-sm font-medium text-indigo-400 truncate" title={session.resourceId}>{session.resourceId}</span>
                                    </div>
                                    <span className="text-[10px] text-gray-600 font-mono truncate pl-4 mt-0.5" title={session.id}>{session.id}</span>
                                </div>
                                <div className="col-span-2 text-sm text-gray-300">
                                    {new Date(session.startTime).toLocaleDateString()}
                                </div>
                                <div className="col-span-2 text-sm text-gray-300 font-mono">
                                    {Math.floor(session.duration / 60)}m {session.duration % 60}s
                                </div>
                                <div className="col-span-2 text-sm text-gray-400">{session.fileSize}</div>
                                <div className="col-span-2">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${session.expiryTime <= now ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                                        {getRemainingTime(session.expiryTime)}
                                    </span>
                                </div>
                                <div className="col-span-1 text-right flex items-center justify-end gap-2">
                                    {role === 'admin' && (
                                        <button onClick={() => onDelete(session.id)} className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    )}
                                    <button onClick={() => handleOpenAudit(session)} className="bg-gray-800 hover:bg-indigo-600 hover:text-white text-gray-300 px-3 py-1.5 rounded text-xs font-medium">
                                        {role === 'admin' ? 'Audit' : 'Playback'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
      )}

      {/* View: User Management */}
      {role === 'admin' && viewMode === 'users' && (
          <div className="animate-fade-in">
              <div className="flex justify-between items-center mb-6">
                 <h2 className="text-xl font-bold text-white">Registered Resources</h2>
                 <div className="flex gap-3">
                     <button onClick={() => onExportUsers && onExportUsers()} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg text-sm font-medium border border-gray-700 flex items-center gap-2">
                         <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                         Export
                     </button>
                     <button onClick={handleImportClick} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg text-sm font-medium border border-gray-700 flex items-center gap-2">
                         <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                         Import
                     </button>
                     <input type="file" accept=".json" ref={importInputRef} className="hidden" onChange={handleFileChange} />
                     
                     <button onClick={handleOpenCreateUser} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-indigo-500/20 flex items-center gap-2">
                         <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                         Add Resource
                     </button>
                 </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl">
                  {users.map((user) => (
                     <div key={user.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-gray-800/30 border-b border-gray-800 last:border-0">
                         <div className="col-span-4 flex items-center gap-3">
                             <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                             </div>
                             <span className="text-white font-medium">{user.username}</span>
                         </div>
                         <div className="col-span-4 text-gray-500 font-mono text-sm">••••••••</div>
                         <div className="col-span-3 text-sm text-gray-400">{new Date(user.createdAt).toLocaleDateString()}</div>
                         <div className="col-span-1 text-right">
                             <button onClick={() => handleOpenEditUser(user)} className="text-gray-400 hover:text-white p-2">
                                 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                             </button>
                         </div>
                     </div>
                  ))}
              </div>
          </div>
      )}

      {/* View: Analytics */}
      {role === 'admin' && viewMode === 'analytics' && (
          <div className="animate-fade-in space-y-8">
              
              {/* Top Bar: Selector */}
              <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-white">Monitoring Analysis</h2>
                    <p className="text-gray-400 text-sm">AI-driven breakdown of resource activity.</p>
                  </div>
                  <div className="relative">
                      <select 
                        value={selectedAnalyticsUser}
                        onChange={(e) => { setSelectedAnalyticsUser(e.target.value); setAnalysisSessionId(null); }}
                        className="appearance-none bg-gray-900 border border-gray-700 text-white py-2 pl-4 pr-10 rounded-lg focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                          <option value="all">All Resources</option>
                          {users.map(u => <option key={u.id} value={u.username}>{u.username}</option>)}
                      </select>
                  </div>
              </div>

              {!analysisSessionId ? (
                /* Overview & Session Selection */
                <>
                    {/* Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                            <p className="text-gray-400 text-sm font-medium uppercase">Total Time</p>
                            <p className="text-3xl font-bold text-white mt-2">{formatDuration(analyticsOverview.totalDuration)}</p>
                        </div>
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                            <p className="text-gray-400 text-sm font-medium uppercase">Camera Active</p>
                            <div className="flex items-baseline gap-2 mt-2">
                                <p className="text-3xl font-bold text-white">{formatDuration(analyticsOverview.cameraDuration)}</p>
                                <span className="text-sm font-medium text-green-500">
                                    {getPercentage(analyticsOverview.cameraDuration, analyticsOverview.totalDuration)}%
                                </span>
                            </div>
                        </div>
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                             <p className="text-gray-400 text-sm font-medium uppercase">Sessions</p>
                             <p className="text-3xl font-bold text-white mt-2">{analyticsOverview.sessionCount}</p>
                        </div>
                    </div>

                    {/* Recording Selection List */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl">
                        <div className="p-4 border-b border-gray-800 bg-gray-800/30 font-semibold text-gray-300">
                            Select Recording to Analyze
                        </div>
                        <div className="divide-y divide-gray-800">
                            {filteredSessionsForAnalytics.length === 0 ? (
                                <div className="p-8 text-center text-gray-500">No recordings found.</div>
                            ) : filteredSessionsForAnalytics.map(session => (
                                <div key={session.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-gray-800/30 transition-colors">
                                    <div className="col-span-4 flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${session.status === 'secure' ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                                        <div>
                                            <p className="text-white font-medium">{session.resourceId}</p>
                                            <p className="text-[10px] text-gray-500">{new Date(session.startTime).toLocaleDateString()} {new Date(session.startTime).toLocaleTimeString()}</p>
                                        </div>
                                    </div>
                                    <div className="col-span-4 text-sm text-gray-400">
                                        Duration: {formatDuration(session.duration)}
                                    </div>
                                    <div className="col-span-4 text-right">
                                        <button 
                                            onClick={() => setAnalysisSessionId(session.id)}
                                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded text-sm font-medium"
                                        >
                                            Detailed Analysis
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
              ) : (
                /* Detailed Analysis View */
                detailedAnalysis ? (
                    <div className="animate-fade-in-up">
                        <button 
                            onClick={() => setAnalysisSessionId(null)}
                            className="mb-4 flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                            Back to List
                        </button>

                        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
                            <div className="p-6 border-b border-gray-800 bg-gray-800/50 flex justify-between items-center">
                                <div>
                                    <h3 className="text-xl font-bold text-white">Session Breakdown</h3>
                                    <p className="text-sm text-gray-400 mt-1">
                                        Resource: <span className="text-indigo-400">{detailedAnalysis.session.resourceId}</span> • 
                                        Date: {new Date(detailedAnalysis.session.startTime).toLocaleDateString()}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-gray-500 uppercase">Total Duration</p>
                                    <p className="text-2xl font-mono font-bold text-white">{formatDuration(detailedAnalysis.session.duration)}</p>
                                </div>
                            </div>

                            <div className="p-6 space-y-6">
                                {detailedAnalysis.segments.length === 0 ? (
                                    <p className="text-center text-gray-500 py-8">No analysis data available for this session.</p>
                                ) : (
                                    detailedAnalysis.segments.map((segment, idx) => (
                                    <div key={idx} className="flex gap-6 border-l-2 border-gray-800 pl-6 relative">
                                        {/* Timeline Dot */}
                                        <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 border-gray-900 
                                            ${segment.category === 'Coding' ? 'bg-blue-500' : 
                                              segment.category === 'Meeting' ? 'bg-purple-500' :
                                              segment.category === 'Idle' ? 'bg-gray-600' : 'bg-green-500'}`}>
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="text-sm font-mono text-gray-500">
                                                    {new Date(segment.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} 
                                                    - 
                                                    {new Date(segment.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase
                                                     ${segment.category === 'Coding' ? 'bg-blue-900/30 text-blue-400' : 
                                                       segment.category === 'Meeting' ? 'bg-purple-900/30 text-purple-400' :
                                                       segment.category === 'Idle' ? 'bg-gray-800 text-gray-400' : 'bg-green-900/30 text-green-400'}`}>
                                                    {segment.category}
                                                </span>
                                            </div>
                                            <p className="text-gray-300 text-sm mb-3">
                                                Time Spent: <span className="text-white font-medium">{Math.round(segment.duration / 60)} minutes</span>
                                            </p>
                                            
                                            {/* Screenshot Thumbnail */}
                                            {segment.screenshot ? (
                                                <div className="w-48 h-28 rounded-lg overflow-hidden border border-gray-700 relative group cursor-pointer hover:border-indigo-500 transition-colors">
                                                    <img src={segment.screenshot} alt="Screen Context" className="w-full h-full object-cover" />
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                        <span className="text-xs text-white font-medium">View Frame</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="w-48 h-28 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-600 text-xs">
                                                    No Preview
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-center items-center py-20">
                        {isLoadingAnalysis ? (
                            <div className="text-indigo-400 animate-pulse flex flex-col items-center">
                                <svg className="w-8 h-8 mb-2 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>Loading Analysis Data...</span>
                            </div>
                        ) : (
                            <p className="text-gray-500">Failed to load detailed analysis.</p>
                        )}
                    </div>
                )
              )}
          </div>
      )}

      {/* Session Detail Modal */}
      {selectedSession && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-5xl max-h-[95vh] flex flex-col shadow-2xl animate-fade-in-up">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900 rounded-t-2xl">
                    <div className="flex items-center gap-4">
                        <div className="bg-indigo-600/20 p-2 rounded-lg">
                            <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-lg">{role === 'admin' ? 'Resource Validation' : 'Session Playback'}</h3>
                            <div className="flex gap-3 text-xs font-mono mt-0.5">
                                <span className="text-gray-500">ID: {selectedSession.id.substring(0,8)}...</span>
                                <span className="text-indigo-400 border-l border-gray-700 pl-3">User: {selectedSession.resourceId}</span>
                            </div>
                        </div>
                    </div>
                    <button onClick={() => setSelectedSession(null)} className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 bg-gray-950">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Video Player */}
                        <div className="lg:col-span-2 space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="text-gray-400 text-sm font-semibold uppercase tracking-wider">Secure Video Playback</h4>
                                {decryptionStatus === 'unlocked' && (
                                    <span className="flex items-center gap-2 text-green-500 text-xs font-mono bg-green-500/10 px-2 py-1 rounded">
                                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                        DECRYPTED
                                    </span>
                                )}
                            </div>
                            
                            <div className="aspect-video bg-black rounded-lg border border-gray-800 flex items-center justify-center relative overflow-hidden group shadow-2xl">
                                {decryptionStatus === 'unlocked' ? (
                                    selectedSession.videoUrl ? (
                                        <video 
                                            src={selectedSession.videoUrl} 
                                            controls 
                                            className="w-full h-full object-contain"
                                        />
                                    ) : videoLoading ? (
                                        <div className="flex flex-col items-center justify-center text-indigo-400 animate-pulse">
                                           <svg className="w-8 h-8 mb-2 animate-spin" fill="none" viewBox="0 0 24 24">
                                               <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                               <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                           </svg>
                                           <span>Retrieving Secure Footage...</span>
                                        </div>
                                    ) : (
                                        <div className="text-center text-gray-500">
                                            <p>Video data unavailable or expired.</p>
                                        </div>
                                    )
                                ) : (
                                  <div className="absolute inset-0 bg-gray-900/50 flex flex-col items-center justify-center text-gray-500 gap-4 p-6 text-center backdrop-blur-sm">
                                    <div className="p-4 bg-gray-800/50 rounded-full">
                                        <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={decryptionStatus === 'locked' ? "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" : "M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"} />
                                        </svg>
                                    </div>
                                    <div className="max-w-md">
                                        <h3 className="text-white font-medium mb-1">Encrypted Content</h3>
                                        <p className="text-sm text-gray-400 mb-4">
                                            {decryptionStatus === 'decrypting' 
                                                ? 'Verifying privileges and retrieving decryption keys...' 
                                                : role === 'admin' 
                                                    ? 'This content is end-to-end encrypted. An audit request must be logged to access playback.' 
                                                    : 'Your session is encrypted. Click below to decrypt and review.'}
                                        </p>
                                    </div>
                                    
                                    {decryptionStatus === 'locked' && (
                                      <button 
                                        onClick={() => handleDecrypt()}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20 flex items-center gap-2"
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                        </svg>
                                        {role === 'admin' ? 'Decrypt & Audit' : 'Decrypt & Play'}
                                      </button>
                                    )}
                                    
                                    {decryptionStatus === 'decrypting' && (
                                        <div className="flex items-center gap-3 text-indigo-400 text-sm bg-indigo-500/10 px-4 py-2 rounded-full border border-indigo-500/20">
                                           <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                           </svg>
                                           <span className="font-mono">Decrypting chunks...</span>
                                        </div>
                                    )}
                                  </div>
                                )}
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl text-center">
                                    <p className="text-xs text-gray-500 uppercase">Duration</p>
                                    <p className="text-white font-mono text-lg mt-1">{Math.floor(selectedSession.duration / 60)}m {selectedSession.duration % 60}s</p>
                                </div>
                                <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl text-center">
                                    <p className="text-xs text-gray-500 uppercase">High Risk Events</p>
                                    <p className="text-red-400 font-mono font-bold text-lg mt-1">{selectedSession.logs.filter(l => l.confidence === 'high').length}</p>
                                </div>
                                <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl text-center">
                                    <p className="text-xs text-gray-500 uppercase">File Size</p>
                                    <p className="text-white font-mono text-lg mt-1">{selectedSession.fileSize}</p>
                                </div>
                            </div>
                        </div>

                        {/* Logs Timeline */}
                        <div className="space-y-4 h-full flex flex-col">
                            <h4 className="text-gray-400 text-sm font-semibold uppercase tracking-wider">AI Analysis Timeline</h4>
                            <div className="flex-1 bg-gray-900 rounded-xl border border-gray-800 p-4 overflow-y-auto max-h-[500px]">
                                {selectedSession.logs.length === 0 ? (
                                    <p className="text-gray-600 text-sm italic">No events logged during this session.</p>
                                ) : (
                                    <div className="space-y-6">
                                        {selectedSession.logs.map(log => (
                                            <div key={log.id} className="relative pl-6 border-l-2 border-gray-800 pb-1 group hover:border-indigo-500/50 transition-colors">
                                                <div className={`absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-gray-900
                                                    ${log.confidence === 'high' ? 'bg-red-500' : 
                                                      log.confidence === 'medium' ? 'bg-yellow-500' : 'bg-green-500'}`}>
                                                </div>
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="text-xs font-mono text-gray-500 group-hover:text-gray-300">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full mr-2
                                                        ${log.type === 'meeting' ? 'bg-purple-900/50 text-purple-300' : 'bg-gray-800 text-gray-300'}`}>
                                                        {log.type}
                                                    </span>
                                                    <span className="text-[10px] text-gray-500 border border-gray-700 rounded px-1">{log.category}</span>
                                                </div>
                                                <p className="text-sm text-gray-300 leading-relaxed">{log.message}</p>
                                                {log.isCameraOn && (
                                                    <div className="flex items-center gap-1 mt-1 text-[10px] text-green-500/70">
                                                        <div className="w-1 h-1 bg-green-500 rounded-full"></div>
                                                        Cam Active
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* User Modal (Create/Edit) */}
      {showUserModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
             <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md shadow-2xl overflow-hidden">
                <div className="bg-gray-800 px-6 py-4 flex justify-between items-center border-b border-gray-700">
                    <h3 className="text-white font-bold text-lg">{isEditingUser ? 'Edit Resource' : 'Create Resource'}</h3>
                    <button onClick={() => setShowUserModal(false)} className="text-gray-400 hover:text-white"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                </div>
                <div className="p-6">
                    {formSuccess ? (
                        <div className="text-center py-8"><h4 className="text-white font-medium">Success</h4></div>
                    ) : (
                        <form onSubmit={handleUserFormSubmit} className="space-y-4">
                            <div><label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Username</label><input type="text" value={userFormUsername} onChange={(e) => setUserFormUsername(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2 text-white" required /></div>
                            <div><label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Password</label><input type="text" value={userFormPassword} onChange={(e) => setUserFormPassword(e.target.value)} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2 text-white" required /></div>
                            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg mt-4">Save</button>
                        </form>
                    )}
                </div>
             </div>
        </div>
      )}
    </div>
  );
};