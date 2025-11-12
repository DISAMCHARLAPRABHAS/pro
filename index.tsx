







import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from '@google/genai';
import { marked } from 'marked';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { auth, db, firebaseInitialized, firebaseError } from './firebase';
// Fix: Correctly import the namespaced firebase object for v8 compatibility.
// FIX: Use a namespace import for Firebase v8 to ensure types are resolved correctly.
import * as firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';


// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://aistudiocdn.com/pdfjs-dist@^4.4.170/build/pdf.worker.mjs';

// Register Chart.js components
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

// Define state machine for app flow
type AppStep = 'input' | 'analyzing' | 'analysis_result' | 'finding_jobs' | 'jobs_result';

interface Skill {
    skillName: string;
    prevalence: number;
}
interface AnalysisResult {
    summary: string;
    skills: Skill[];
    role: string;
    atsScore: number;
    improvementSuggestions: string;
}

interface Job {
    title: string;
    company: string;
    description: string;
    location: string;
    applyLink: string;
    datePosted?: string;
}

interface JobResult {
    jobs: Job[];
    sources: any[];
}

interface AnalysisHistoryItem extends AnalysisResult {
    id: string;
    createdAt: Date;
}


const SkillsChart = ({ skills }: { skills: Skill[] }) => {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstanceRef = useRef<Chart | null>(null);

    useEffect(() => {
        if (chartRef.current && skills) {
            if (chartInstanceRef.current) {
                chartInstanceRef.current.destroy();
            }

            const ctx = chartRef.current.getContext('2d');
            if (!ctx) return;
            
            const sortedSkills = [...skills].sort((a, b) => a.prevalence - b.prevalence);
            const skillLabels = sortedSkills.map(s => s.skillName);
            const prevalenceData = sortedSkills.map(s => s.prevalence);

            chartInstanceRef.current = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: skillLabels,
                    datasets: [{
                        label: 'Skill Prevalence (1-5)',
                        data: prevalenceData,
                        backgroundColor: 'rgba(66, 133, 244, 0.7)',
                        borderColor: 'rgba(66, 133, 244, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (context) => `Prevalence: ${context.parsed.x}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            max: 5,
                            ticks: { stepSize: 1 }
                        }
                    }
                }
            });
        }

        return () => {
            if (chartInstanceRef.current) {
                chartInstanceRef.current.destroy();
            }
        };
    }, [skills]);

    return (
        <div className="chart-container">
            <canvas ref={chartRef}></canvas>
        </div>
    );
};

const AuthScreen = ({ onGoogleSignIn }: { onGoogleSignIn: () => void }) => {
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!auth) {
            setError("Authentication service is not available.");
            return;
        }

        try {
            if (isSignUp) {
                // Fix: Use v8 namespaced API for createUserWithEmailAndPassword
                await auth.createUserWithEmailAndPassword(email, password);
            } else {
                // Fix: Use v8 namespaced API for signInWithEmailAndPassword
                await auth.signInWithEmailAndPassword(email, password);
            }
            // onAuthStateChanged in the main App component will handle successful login
        } catch (err: any) {
            let friendlyError = 'An unknown error occurred.';
            if (err.code) {
                switch (err.code) {
                    case 'auth/email-already-in-use':
                        friendlyError = 'This email address is already registered. Please sign in.';
                        break;
                    case 'auth/invalid-email':
                        friendlyError = 'Please enter a valid email address.';
                        break;
                    case 'auth/weak-password':
                        friendlyError = 'Password should be at least 6 characters long.';
                        break;
                    case 'auth/user-not-found':
                    case 'auth/wrong-password':
                    case 'auth/invalid-credential':
                        friendlyError = 'Invalid email or password. Please try again.';
                        break;
                    default:
                        friendlyError = `Authentication failed. Please try again. (${err.code})`;
                }
            }
            setError(friendlyError);
        }
    };

    return (
        <div className="auth-screen">
            <h2>{isSignUp ? 'Create an Account' : 'Welcome Back!'}</h2>
            <p>{isSignUp ? 'Sign up to analyze your resume and find jobs.' : 'Sign in to access your dashboard.'}</p>
            
            {error && <div className="error-message" style={{textAlign: 'left', marginTop: 0, marginBottom: '1rem'}}>{error}</div>}

            <form onSubmit={handleEmailAuth} className="auth-form">
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email Address"
                    required
                    className="form-input"
                />
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    className="form-input"
                />
                <button type="submit" className="button button-primary" style={{width: '100%'}}>
                    {isSignUp ? 'Sign Up' : 'Sign In'}
                </button>
            </form>

            <p className="form-toggle">
                {isSignUp ? 'Already have an account?' : "Don't have an account?"}
                <button onClick={() => { setIsSignUp(!isSignUp); setError(''); }}>
                    {isSignUp ? 'Sign In' : 'Sign Up'}
                </button>
            </p>

            <div className="auth-divider">
                <span>OR</span>
            </div>

            <button onClick={onGoogleSignIn} className="button button-secondary google-button">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><path d="M16.51 8.1H9v3.08h4.34c-.17 1.03-.64 1.9-1.38 2.52v2.05h2.64C16.02 14.25 16.51 11.43 16.51 8.1Z" fill="#4285F4"></path><path d="M9 17c2.35 0 4.31-.78 5.75-2.12l-2.64-2.05c-.78.52-1.78.83-2.91.83-2.25 0-4.15-1.52-4.83-3.56H1.4v2.12C2.84 15.12 5.66 17 9 17Z" fill="#34A853"></path><path d="M4.17 10.33c-.17-.52-.26-1.07-.26-1.63s.09-1.11.26-1.63V4.95H1.4C.54 6.6.02 8.25.02 10s.52 3.4 1.38 5.05l2.79-2.12Z" fill="#FBBC05"></path><path d="M9 3.35c1.27 0 2.4.43 3.3 1.29l2.27-2.27C13.31.84 11.35 0 9 0 5.66 0 2.84 1.88 1.4 4.95l2.77 2.12C4.85 4.87 6.75 3.35 9 3.35Z" fill="#EA4335"></path></svg>
                <span>Sign in with Google</span>
            </button>
        </div>
    );
};


const App = () => {
    // Fix: Use firebase.User type for v8 compatibility
    const [user, setUser] = useState<firebase.User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [step, setStep] = useState<AppStep>('input');
    const [resumeText, setResumeText] = useState('');
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
    const [jobsResult, setJobsResult] = useState<JobResult | null>(null);
    const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryItem[]>([]);
    const [error, setError] = useState<string | null>(firebaseError);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [jobSortOrder, setJobSortOrder] = useState('relevance');

    const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.API_KEY as string }), []);

    // --- Authentication ---
    useEffect(() => {
        if (!firebaseInitialized || !auth) {
            setAuthLoading(false);
            return;
        }
        // Fix: Use v8 namespaced API for onAuthStateChanged
        const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                await fetchAnalysisHistory(currentUser.uid);
            } else {
                setUser(null);
                // Reset state on logout
                setAnalysisHistory([]);
                handleStartOver();
            }
            setAuthLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleGoogleSignIn = async () => {
        if (!firebaseInitialized || !auth) return;
        // Fix: Use v8 namespaced API for GoogleAuthProvider
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            // Fix: Use v8 namespaced API for signInWithPopup
            await auth.signInWithPopup(provider);
        } catch (error) {
            console.error("Authentication error:", error);
            setError("Failed to sign in. Please try again.");
        }
    };

    const handleSignOut = async () => {
        if (!firebaseInitialized || !auth) return;
        try {
            // Fix: Use v8 namespaced API for signOut
            await auth.signOut();
        } catch (error) {
            console.error("Sign out error:", error);
        }
    };

    // --- Data Handling ---
    const fetchAnalysisHistory = async (uid: string) => {
        if (!firebaseInitialized || !db) return;
        try {
            // Fix: Use v8 namespaced API for Firestore queries
            const q = db.collection("analyses")
                .where("userId", "==", uid)
                .orderBy("createdAt", "desc");
            const querySnapshot = await q.get();
            const history: AnalysisHistoryItem[] = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                history.push({
                    id: doc.id,
                    ...data as AnalysisResult,
                    // Fix: Use v8 namespaced Timestamp type
                    createdAt: (data.createdAt as firebase.firestore.Timestamp).toDate()
                });
            });
            setAnalysisHistory(history);
        } catch (e) {
            console.error("Error fetching history: ", e);
            setError("Could not load your analysis history.");
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setError(firebaseError);
        setResumeText('');

        try {
            const extension = file.name.split('.').pop()?.toLowerCase();
            let text = '';

            if (extension === 'txt' || extension === 'md') {
                text = await file.text();
            } else if (extension === 'docx') {
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer });
                text = result.value;
            } else if (extension === 'pdf') {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
                    fullText += pageText + '\n';
                }
                text = fullText;
            } else {
                throw new Error('Unsupported file type. Please upload a .txt, .md, .pdf, or .docx file.');
            }

            setResumeText(text);

        } catch (e) {
            console.error('Error reading file:', e);
            const message = e instanceof Error ? e.message : 'Failed to read the file. Please try another file.';
            setError(message);
        } finally {
            event.target.value = '';
        }
    };


    const handleAnalyze = async () => {
        if (!resumeText.trim()) return;
        if (firebaseInitialized && !user) {
            setError("Please sign in to analyze and save your results.");
            return;
        }
        
        setStep('analyzing');
        setError(firebaseError);
        setAnalysisResult(null);

        try {
            const analysisSchema = {
                type: Type.OBJECT,
                properties: {
                    summary: { type: Type.STRING, description: "A concise two-sentence summary of the candidate's profile." },
                    skills: {
                        type: Type.ARRAY, items: {
                            type: Type.OBJECT, properties: {
                                skillName: { type: Type.STRING },
                                prevalence: { type: Type.NUMBER, description: "Score from 1 (low) to 5 (high)." }
                            }, required: ["skillName", "prevalence"]
                        }
                    },
                    role: { type: Type.STRING, description: "A suitable job title for the candidate." },
                    atsScore: { type: Type.NUMBER, description: "An estimated ATS-friendliness score out of 100." },
                    improvementSuggestions: { type: Type.STRING, description: "2-3 actionable bullet points ('*') on improving the resume." }
                },
                required: ["summary", "skills", "role", "atsScore", "improvementSuggestions"]
            };

            const response = await ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: `Analyze this resume: \n\n${resumeText}`,
                config: { responseMimeType: "application/json", responseSchema: analysisSchema },
            });
            
            const resultJson = JSON.parse(response.text) as AnalysisResult;
            setAnalysisResult(resultJson);
            setStep('analysis_result');
            
            // Save to Firestore
            if (firebaseInitialized && user && db) {
                // Fix: Use v8 namespaced API to add a document
                await db.collection("analyses").add({
                    ...resultJson,
                    userId: user.uid,
                    createdAt: new Date(),
                });
                await fetchAnalysisHistory(user.uid); // Refresh history
            }
        } catch (e: any) {
            console.error('Analysis Error:', e);
            const analysisError = `Analysis failed: ${e.message}.`;
            setError(firebaseError ? `${firebaseError}\n${analysisError}` : analysisError);
            setStep('input');
        }
    };

    const handleFindJobs = async () => {
        if (!analysisResult) return;
        setStep('finding_jobs');
        setError(firebaseError);
        setJobsResult(null);

        try {
            const prompt = `Based on this resume analysis, find at least 20 relevant and recent job openings in India.
            Analysis:
            - Ideal Role: ${analysisResult.role}
            - Key Skills: ${analysisResult.skills.map(s => s.skillName).join(', ')}
            IMPORTANT: Return a JSON object inside a markdown block (\`\`\`json ... \`\`\`). The JSON object must have one key "jobs", an array of objects. Each object must have keys: "title", "company", "location", "description" (1-2 sentences), "applyLink" (a direct URL), and "datePosted" (the estimated posting date in "YYYY-MM-DD" format).`;

            const response = await ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: prompt,
                config: { tools: [{ googleSearch: {} }] },
            });
            
            const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            const text = response.text;
            
            const jsonBlockMatch = text.match(/```json\n([\s\S]*?)\n```/);
            if (!jsonBlockMatch || !jsonBlockMatch[1]) {
                throw new Error("AI response did not contain a valid JSON job list.");
            }

            const jsonString = jsonBlockMatch[1];
            const resultJson = JSON.parse(jsonString);

            setJobsResult({ jobs: resultJson.jobs || [], sources: groundingChunks });
            setStep('jobs_result');

        } catch (e: any) {
            console.error('Job Search Error:', e);
            const jobError = `Job search failed: ${e.message}.`;
            setError(firebaseError ? `${firebaseError}\n${jobError}` : jobError);
            setStep('analysis_result');
        }
    };
    
    const handleHistoryItemClick = (item: AnalysisHistoryItem) => {
        setAnalysisResult(item);
        setStep('analysis_result');
        setJobsResult(null); // Clear previous job results
        setError(firebaseError);
    };

    const handleStartOver = () => {
        setStep('input');
        setResumeText('');
        setAnalysisResult(null);
        setJobsResult(null);
        setError(firebaseError);
    };

    const isLoading = step === 'analyzing' || step === 'finding_jobs' || (authLoading && firebaseInitialized);
    
    const sortedJobs = useMemo(() => {
        if (!jobsResult?.jobs) return [];
        
        const jobsToSort = [...jobsResult.jobs];
        if (jobSortOrder === 'relevance') {
            return jobsToSort;
        }

        jobsToSort.sort((a, b) => {
            const dateA = a.datePosted ? new Date(a.datePosted).getTime() : 0;
            const dateB = b.datePosted ? new Date(b.datePosted).getTime() : 0;

            // Jobs without dates go to the bottom
            if (dateA === 0 && dateB !== 0) return 1;
            if (dateB === 0 && dateA !== 0) return -1;
            
            if (jobSortOrder === 'newest') {
                return dateB - dateA;
            }
            if (jobSortOrder === 'oldest') {
                return dateA - dateB;
            }
            return 0;
        });
        
        return jobsToSort;
    }, [jobsResult, jobSortOrder]);
    
    const getScoreColor = (score: number) => {
        if (score >= 85) return 'var(--success-color)';
        if (score >= 70) return 'var(--warning-color)';
        return 'var(--danger-color)';
    };

    const renderAuth = () => {
        if (!firebaseInitialized) return null;
        return (
            <div className="auth-container">
                {authLoading ? (
                    <div className="spinner" style={{width: '20px', height: '20px'}}></div>
                ) : user ? (
                    <div className="user-info">
                        {user.photoURL ? (
                             <img src={user.photoURL} alt={user.displayName || 'User avatar'} />
                        ) : (
                            <span className="material-icons user-icon">account_circle</span>
                        )}
                        <span>{user.displayName || user.email}</span>
                        <button onClick={handleSignOut} className="button button-secondary button-auth">Sign Out</button>
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className="container">
            {renderAuth()}
            <div className="header">
                <h1>AI Resume Analyzer & Job Finder</h1>
                {(!user && firebaseInitialized) && <p>Sign in to get an expert analysis and find relevant job opportunities.</p>}
            </div>

            {error && !user && <div className="error-message">{error.split('\n').map((line, i) => <p key={i} style={{margin:0, padding: '0.1rem 0'}}>{line}</p>)}</div>}
            
            {authLoading && firebaseInitialized && <Loader text="Authenticating..." />}

            {!authLoading && !user && firebaseInitialized && (
                <AuthScreen onGoogleSignIn={handleGoogleSignIn} />
            )}
            
            {!authLoading && (!firebaseInitialized || user) && (
                <>
                    {error && user && <div className="error-message">{error.split('\n').map((line, i) => <p key={i} style={{margin:0, padding: '0.1rem 0'}}>{line}</p>)}</div>}
                    {(step === 'input' || step === 'analyzing') && !analysisResult && (
                         <div className="resume-input">
                            <textarea
                                value={resumeText}
                                onChange={(e) => setResumeText(e.target.value)}
                                placeholder="Paste your full resume here, or upload a file below."
                                disabled={isLoading}
                                aria-label="Resume Input"
                            />
                            <p className="upload-helper">Upload your resume file (.txt, .md, .pdf, .docx).</p>
                            <div className="button-group">
                                 <button className="button button-secondary" onClick={handleUploadClick} disabled={isLoading}>
                                     <span className="material-icons">upload_file</span>
                                     Upload File
                                 </button>
                                 <button className="button button-primary" onClick={handleAnalyze} disabled={isLoading || !resumeText.trim()}>
                                    <span className="material-icons">psychology</span>
                                    Analyze Resume
                                 </button>
                            </div>
                            <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept=".txt,.md,.pdf,.docx" />
                         </div>
                    )}
                    
                    {step === 'analyzing' && <Loader text="Analyzing your resume..." />}

                    {(step === 'analysis_result' || step === 'finding_jobs' || step === 'jobs_result') && analysisResult && (
                        <div className="results-section analysis-results">
                            <h2>Resume Analysis</h2>
                             <div className="analysis-grid">
                                <div className="results-card">
                                    <h3>Summary</h3>
                                    <p>{analysisResult.summary}</p>
                                    <h3>Suggested Role</h3>
                                    <p className="role-suggestion">{analysisResult.role}</p>
                                </div>
                                <div className="ats-score-container">
                                     <div className="ats-score-circle" style={{backgroundColor: getScoreColor(analysisResult.atsScore)}}>
                                        {analysisResult.atsScore}
                                    </div>
                                    <h3>ATS Friendliness Score</h3>
                                </div>
                             </div>
                             <div className="results-card" style={{marginTop: '1.5rem'}}>
                                <div className="improvements-section">
                                    <h3><span className="material-icons">lightbulb</span>Areas for Improvement</h3>
                                    <div dangerouslySetInnerHTML={{ __html: marked(analysisResult.improvementSuggestions) }} />
                                </div>
                            </div>
                             <div className="results-card" style={{marginTop: '1.5rem'}}>
                                <h3>Key Skills Analysis</h3>
                                <SkillsChart skills={analysisResult.skills} />
                                <div className="skills-list">
                                    {analysisResult.skills.map(skill => ( <span key={skill.skillName} className="skill-tag">{skill.skillName}</span> ))}
                                </div>
                            </div>
                             <div className="button-group">
                                 <button className="button button-primary" onClick={handleFindJobs} disabled={isLoading}>
                                     <span className="material-icons">work</span> Find Jobs
                                 </button>
                                 <button className="button button-secondary" onClick={handleStartOver} disabled={isLoading}>
                                     <span className="material-icons">refresh</span> Start New Analysis
                                 </button>
                            </div>
                        </div>
                    )}

                    {step === 'finding_jobs' && <Loader text="Searching for the best jobs for you..." />}

                    {step === 'jobs_result' && jobsResult && (
                        <div className="results-section job-results">
                             <div className="job-header">
                                <h2>Recommended Job Openings</h2>
                                <div className="sort-container">
                                    <label htmlFor="job-sort">Sort by:</label>
                                    <select 
                                        id="job-sort" 
                                        value={jobSortOrder} 
                                        onChange={(e) => setJobSortOrder(e.target.value)}
                                        className="sort-select"
                                    >
                                        <option value="relevance">Relevance</option>
                                        <option value="newest">Date (Newest)</option>
                                        <option value="oldest">Date (Oldest)</option>
                                    </select>
                                </div>
                            </div>
                            <div className="job-listings">
                                {sortedJobs.map((job, index) => {
                                     let sourceHostname = null;
                                     try { sourceHostname = new URL(job.applyLink).hostname.replace(/^www\./, ''); } catch (e) {}
                                     return (
                                         <div key={index} className="job-card">
                                             <h3>{job.title}</h3>
                                             <div className="job-card-meta">
                                                 <p className="company">{job.company} - {job.location}</p>
                                                 {job.datePosted && <p className="job-date">{job.datePosted}</p>}
                                             </div>
                                             {sourceHostname && <p className="job-source">Source: {sourceHostname}</p>}
                                             <p className="description">{job.description}</p>
                                             <a href={job.applyLink} target="_blank" rel="noopener noreferrer" className="button button-primary">Apply Now</a>
                                         </div>
                                     );
                                })}
                            </div>

                            {jobsResult.sources.length > 0 && (
                                <details className="sources-container">
                                     <summary>View Sources ({jobsResult.sources.length})</summary>
                                     <ul className="sources-list">
                                        {jobsResult.sources.filter(s => s.web).map((s, i) => (
                                             <li key={i}><a href={s.web.uri} target="_blank" rel="noopener noreferrer">{s.web.title || s.web.uri}</a></li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    )}

                    {analysisHistory.length > 0 && firebaseInitialized && step === 'input' && !analysisResult && (
                        <div className="history-section">
                            <h2>Analysis History</h2>
                            <div className="history-grid">
                                {analysisHistory.map(item => (
                                    <div key={item.id} className="history-card" onClick={() => handleHistoryItemClick(item)}>
                                        <h4>{item.role}</h4>
                                        <p>{item.createdAt.toLocaleDateString()}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const Loader = ({ text }: { text: string }) => (
    <div className="loader">
        <div className="spinner"></div>
        <span>{text}</span>
    </div>
);

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);