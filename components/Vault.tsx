import React, { useState, useEffect } from 'react';
import { RecordedSession, ResourceUser } from '../types';

interface VaultProps {
  sessions: RecordedSession[];
  role?: 'admin' | 'employee';
  onDelete: (sessionId: string) => void;
  onCreateUser?: (newUser: ResourceUser) => void;
  users?: ResourceUser[];
  onUpdateUser?: (updatedUser: ResourceUser) => void;
}

export const Vault: React.FC<VaultProps> = ({ 
  sessions, 
  role = 'admin', 
  onDelete, 
  onCreateUser,
  users = [],
  onUpdateUser
}) => {
  const [now, setNow] = useState(Date.now());
  const [selectedSession, setSelectedSession] = useState<RecordedSession | null>(null);
  const [decryptionStatus, setDecryptionStatus] = useState<'locked' | 'decrypting' | 'unlocked'>('locked');
  
  // View State for Admin
  const [viewMode, setViewMode] = useState<'sessions' | 'users'>('sessions');

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Create/Edit User Modal State
  const [showUserModal, setShowUserModal] = useState(false);
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userFormUsername, setUserFormUsername] = useState('');
  const [userFormPassword, setUserFormPassword] = useState('');
  const [formSuccess, setFormSuccess] = useState(false);

  // Update "now" every minute to update remaining time and filter out expired sessions
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  const getRemainingTime = (expiry: number) => {
    const diff = expiry - now;
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
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

  const handleUserFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userFormUsername || !userFormPassword) return;

    if (isEditingUser && onUpdateUser && editingUserId) {
        // Find original to preserve creation date
        const original = users.find(u => u.id === editingUserId);
        if (original) {
            onUpdateUser({
                ...original,
                username: userFormUsername,
                password: userFormPassword
            });
        }
    } else if (!isEditingUser && onCreateUser) {
        onCreateUser({
            id: '', // ID will be assigned by parent
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

  // Filter sessions based on role and search query
  const activeSessions = sessions.filter(s => {
      // Role logic
      const isVisibleForRole = role === 'admin' ? true : (s.status !== 'expired' && s.expiryTime > now);
      if (!isVisibleForRole) return false;

      // Search logic
      if (searchQuery.trim() === '') return true;
      const query = searchQuery.toLowerCase();
      return (
          s.resourceId.toLowerCase().includes(query) || 
          s.id.toLowerCase().includes(query)
      );
  });

  // Calculate high risk sessions count (sessions containing at least one high-risk log)
  const highRiskSessionsCount = activeSessions.filter(session => 
    session.logs.some(log => log.confidence === 'high')
  ).length;

  const handleOpenAudit = (session: RecordedSession) => {
    setSelectedSession(session);
    setDecryptionStatus('locked');
  };

  const handleDecrypt = () => {
    setDecryptionStatus('decrypting');
    // Simulate API call to verify admin keys and fetch secure stream url
    setTimeout(() => {
      setDecryptionStatus('unlocked');
    }, 2000);
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

            {/* Admin Tabs */}
            <div className="flex border-b border-gray-800 mb-6">
                <button 
                    onClick={() => { setViewMode('sessions'); setSearchQuery(''); }}
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
                    <p className="text-gray-400 text-sm mt-1 ml-14">
                        {role === 'admin' 
                            ? 'Audit compliance recordings.' 
                            : 'Review your recent sessions.'}
                    </p>
                </div>
                <span className="text-sm text-gray-500 bg-gray-900 px-3 py-1 rounded-full border border-gray-800 hidden sm:block">
                    {role === 'admin' ? (
                        <>Retention: <span className="text-gray-300 font-semibold">Manual Deletion</span></>
                    ) : (
                        <>Auto-deletion: <span className="text-gray-300 font-semibold">24 Hours</span></>
                    )}
                </span>
            </div>

            {/* Search Bar */}
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
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800 mb-4">
                            <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-medium text-white">No Recordings Available</h3>
                        {searchQuery && (
                             <p className="text-gray-500 text-sm mt-2">Try adjusting your search criteria.</p>
                        )}
                    </div>
                ) : (
                    <div className="divide-y divide-gray-800">
                        {activeSessions.map((session) => (
                            <div key={session.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-gray-800/30 transition-colors group">
                                <div className="col-span-3 flex flex-col justify-center">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${session.status === 'secure' ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                                        <span className="text-sm font-medium text-indigo-400 truncate" title={session.resourceId}>
                                            {session.resourceId}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-gray-600 font-mono truncate pl-4 mt-0.5" title={session.id}>
                                        {session.id}
                                    </span>
                                </div>
                                <div className="col-span-2 text-sm text-gray-300">
                                    {new Date(session.startTime).toLocaleDateString()} <span className="text-gray-600 text-xs ml-1">{new Date(session.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                </div>
                                <div className="col-span-2 text-sm text-gray-300 font-mono">
                                    {Math.floor(session.duration / 60)}m {session.duration % 60}s
                                </div>
                                <div className="col-span-2 text-sm text-gray-400">
                                    {session.fileSize}
                                </div>
                                <div className="col-span-2">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${session.expiryTime <= now ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        {getRemainingTime(session.expiryTime)}
                                    </span>
                                </div>
                                <div className="col-span-1 text-right flex items-center justify-end gap-2">
                                    {role === 'admin' && (
                                        <button 
                                            onClick={() => onDelete(session.id)}
                                            title="Delete Recording"
                                            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                        >
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    )}
                                    <button 
                                        onClick={() => handleOpenAudit(session)}
                                        className="bg-gray-800 hover:bg-indigo-600 hover:text-white text-gray-300 px-3 py-1.5 rounded text-xs font-medium transition-all transform group-hover:scale-105 shadow-sm whitespace-nowrap"
                                    >
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
                 <div>
                    <h2 className="text-xl font-bold text-white">Registered Resources</h2>
                    <p className="text-gray-400 text-sm">Manage access credentials for remote monitoring.</p>
                 </div>
                 <button 
                    onClick={handleOpenCreateUser}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-indigo-500/20 flex items-center gap-2"
                 >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add Resource
                 </button>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl">
                  <div className="grid grid-cols-12 gap-4 p-4 border-b border-gray-800 bg-gray-800/50 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      <div className="col-span-4">Username / Resource ID</div>
                      <div className="col-span-4">Password</div>
                      <div className="col-span-3">Created</div>
                      <div className="col-span-1 text-right">Edit</div>
                  </div>
                  
                  {users.length === 0 ? (
                      <div className="p-8 text-center text-gray-500">No users found.</div>
                  ) : (
                      <div className="divide-y divide-gray-800">
                          {users.map((user) => (
                             <div key={user.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-gray-800/30 transition-colors">
                                 <div className="col-span-4 flex items-center gap-3">
                                     <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                                         <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                         </svg>
                                     </div>
                                     <span className="text-white font-medium">{user.username}</span>
                                 </div>
                                 <div className="col-span-4 text-gray-500 font-mono text-sm">
                                     ••••••••
                                 </div>
                                 <div className="col-span-3 text-sm text-gray-400">
                                     {new Date(user.createdAt).toLocaleDateString()}
                                 </div>
                                 <div className="col-span-1 text-right">
                                     <button 
                                         onClick={() => handleOpenEditUser(user)}
                                         className="text-gray-400 hover:text-white p-2 rounded hover:bg-gray-700 transition-colors"
                                         title="Edit User"
                                     >
                                         <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                         </svg>
                                     </button>
                                 </div>
                             </div>
                          ))}
                      </div>
                  )}
              </div>
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
                        {/* Video Player Mock */}
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
                                    ) : (
                                        <div className="text-center text-gray-500">
                                            <p>Recording data was not retained (mock mode).</p>
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
                                        onClick={handleDecrypt}
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
                                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full
                                                        ${log.type === 'meeting' ? 'bg-purple-900/50 text-purple-300' : 'bg-gray-800 text-gray-300'}`}>
                                                        {log.type}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-gray-300 leading-relaxed">{log.message}</p>
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

      {/* User Form Modal (Create/Edit) */}
      {showUserModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
             <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md shadow-2xl overflow-hidden">
                <div className="bg-gray-800 px-6 py-4 flex justify-between items-center border-b border-gray-700">
                    <h3 className="text-white font-bold text-lg">{isEditingUser ? 'Edit Resource' : 'Create Resource'}</h3>
                    <button onClick={() => setShowUserModal(false)} className="text-gray-400 hover:text-white">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="p-6">
                    {formSuccess ? (
                        <div className="text-center py-8">
                             <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                                 <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                 </svg>
                             </div>
                             <h4 className="text-white font-medium">{isEditingUser ? 'Updated Successfully' : 'Created Successfully'}</h4>
                        </div>
                    ) : (
                        <form onSubmit={handleUserFormSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Username / Resource ID</label>
                                <input 
                                    type="text" 
                                    value={userFormUsername}
                                    onChange={(e) => setUserFormUsername(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2 text-white focus:border-indigo-500 outline-none"
                                    placeholder="e.g. employee.name"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Password</label>
                                <input 
                                    type="text" 
                                    value={userFormPassword}
                                    onChange={(e) => setUserFormPassword(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2 text-white focus:border-indigo-500 outline-none"
                                    placeholder="••••••••"
                                    required
                                />
                                <p className="text-[10px] text-gray-500 mt-1">Visible for admin convenience.</p>
                            </div>
                            <button 
                                type="submit"
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg mt-4 transition-colors"
                            >
                                {isEditingUser ? 'Save Changes' : 'Create Credentials'}
                            </button>
                        </form>
                    )}
                </div>
             </div>
        </div>
      )}
    </div>
  );
};