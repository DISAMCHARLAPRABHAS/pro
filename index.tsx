import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from '@google/genai';
import { marked } from 'marked';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { auth, db, firebaseInitialized, firebaseError } from './firebase';
import { onAuthStateChanged, getRedirectResult, signInWithRedirect, signOut, GoogleAuthProvider, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';


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
    experienceLevel: string;
}

interface Job {
    title: string;
    company: string;
    description: string;
    location: string;
    applyLink: string;
    datePosted?: string;
    sourceUrl?: string;
}

interface JobResult {
    jobs: Job[];
}

const defaultUserProfile = {
    preferredTitles: '',
    minSalary: '',
    maxSalary: '',
    careerGoals: '',
    locationPreference: '',
    jobAlertsEnabled: false,
    jobAlertsFrequency: 'weekly' as 'daily' | 'weekly',
};

interface UserProfile {
    preferredTitles: string;
    minSalary: string;
    maxSalary: string;
    careerGoals: string;
    locationPreference: string;
    jobAlertsEnabled: boolean;
    jobAlertsFrequency: 'daily' | 'weekly';
}

const PDFPreview = ({ file }: { file: ArrayBuffer | null }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!file || !container) return;

        container.innerHTML = ''; // Clear previous renders

        const renderPdf = async () => {
            try {
                // Use a copy of the buffer as pdfjs might transfer it
                const pdf = await pdfjsLib.getDocument(file.slice(0)).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    // Adjust scale for better resolution
                    const scale = window.devicePixelRatio || 1.5;
                    const viewport = page.getViewport({ scale });

                    const canvas = document.createElement('canvas');
                    canvas.style.display = 'block';
                    if (i < pdf.numPages) {
                        canvas.style.marginBottom = '1rem';
                    }

                    const context = canvas.getContext('2d');
                    if (!context) continue;

                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    // Fix: Add the 'canvas' property to the render context to satisfy the RenderParameters type for pdfjs-dist.
                    // This is likely required due to a mismatch in the project's type definitions.
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport,
                        canvas: canvas,
                    };
                    await page.render(renderContext).promise;
                    container.appendChild(canvas);
                }
            } catch (error) {
                console.error("Error rendering PDF:", error);
                container.innerHTML = `<div class="error-message">Failed to render PDF preview. The file might be corrupted or in an unsupported format.</div>`;
            }
        };

        renderPdf();

    }, [file]);

    return <div ref={containerRef} className="pdf-preview-wrapper"></div>;
};

const PreviewRenderer = ({ content, type }: { content: string | ArrayBuffer | null; type: 'html' | 'pdf' | 'text' | null }) => {
    if (content === null) {
        return <div className="preview-placeholder card"><p>No preview available.</p></div>;
    }

    switch (type) {
        case 'html':
            return <div className="html-preview" dangerouslySetInnerHTML={{ __html: content as string }} />;
        case 'text':
            return <pre className="text-preview">{content as string}</pre>;
        case 'pdf':
            return <PDFPreview file={content as ArrayBuffer} />;
        default:
            return <div className="preview-placeholder card"><p>Unsupported file type for preview.</p></div>;
    }
};

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
                        backgroundColor: '#4ade80',
                        borderColor: '#1f2937',
                        borderWidth: 2,
                        borderRadius: 4
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

interface JobCardProps {
    job: Job;
    isSaved: boolean;
    onToggleSave: () => void;
    cardIndex: number;
    feedback?: 'like' | 'dislike' | null;
    onLike?: () => void;
    onDislike?: () => void;
}


const JobCard: React.FC<JobCardProps> = ({ job, isSaved, onToggleSave, cardIndex, feedback, onLike, onDislike }) => {
    let sourceHostname = null;
    const sourceUrl = job.sourceUrl || job.applyLink;
    try { sourceHostname = new URL(String(sourceUrl)).hostname.replace(/^www\./, ''); } catch (e) { }

    const [isExpanded, setIsExpanded] = useState(false);
    const TRUNCATE_LENGTH = 180;
    const isLongDescription = job.description.length > TRUNCATE_LENGTH;

    const descriptionText = isLongDescription && !isExpanded
        ? `${job.description.substring(0, TRUNCATE_LENGTH)}...`
        : job.description;

    return (
        <div className="job-card card" style={{ '--card-index': cardIndex } as React.CSSProperties}>
            <button className={`save-job-button ${isSaved ? 'saved' : ''}`} onClick={onToggleSave} aria-label={isSaved ? 'Unsave job' : 'Save job'}>
                <span className="material-icons">{isSaved ? 'bookmark' : 'bookmark_border'}</span>
            </button>
            <h3>{job.title}</h3>
            <div className="job-card-meta">
                <p className="company">{job.company} - {job.location}</p>
                {job.datePosted && <p className="job-date">{job.datePosted}</p>}
            </div>
            {sourceHostname && <p className="job-source">Source: <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{sourceHostname}</a></p>}
            <div className="description-container">
                <p className="description">{descriptionText}</p>
                {isLongDescription && (
                    <button className="read-more-button" onClick={() => setIsExpanded(!isExpanded)}>
                        {isExpanded ? 'Read Less' : 'Read More'}
                    </button>
                )}
            </div>
            <div className="job-card-actions">
                 {onLike && onDislike ? (
                    <div className="feedback-buttons">
                        <button
                            className={`feedback-button like-button ${feedback === 'like' ? 'liked' : ''}`}
                            onClick={onLike}
                            aria-label="Like this job recommendation"
                        >
                            <span className="material-icons">thumb_up</span>
                        </button>
                        <button
                            className={`feedback-button dislike-button ${feedback === 'dislike' ? 'disliked' : ''}`}
                            onClick={onDislike}
                            aria-label="Dislike this job recommendation"
                        >
                            <span className="material-icons">thumb_down</span>
                        </button>
                    </div>
                ) : <div />}
                <a href={job.applyLink} target="_blank" rel="noopener noreferrer" className="button button-primary">
                    Apply Now
                    <span className="material-icons button-external-icon">open_in_new</span>
                </a>
            </div>
        </div>
    );
};

const JobCardSkeleton = () => (
    <div className="job-card-skeleton card">
        <div className="skeleton-line title"></div>
        <div className="skeleton-line meta"></div>
        <div className="skeleton-line description"></div>
        <div className="skeleton-line description short"></div>
        <div className="skeleton-line button"></div>
    </div>
);


const App = () => {
    const [step, setStep] = useState<AppStep>('input');
    const [resumeText, setResumeText] = useState('');
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
    const [jobsResult, setJobsResult] = useState<JobResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [jobSortOrder, setJobSortOrder] = useState('relevance');
    const [locationFilter, setLocationFilter] = useState('');
    const [experienceLevel, setExperienceLevel] = useState('');
    const [preferredCompanies, setPreferredCompanies] = useState('');
    const [savedJobs, setSavedJobs] = useState<Job[]>([]);
    const [userProfile, setUserProfile] = useState<UserProfile>(defaultUserProfile);
    const [profileSaved, setProfileSaved] = useState(false);
    const [isFindingMoreJobs, setIsFindingMoreJobs] = useState(false);
    const [user, setUser] = useState<User | null>(null);
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [jobFeedback, setJobFeedback] = useState<Record<string, 'like' | 'dislike'>>({});
    const [currentView, setCurrentView] = useState<'main' | 'saved_jobs'>('main');

    // Resume preview state
    const [activeTab, setActiveTab] = useState<'text' | 'preview'>('text');
    const [previewContent, setPreviewContent] = useState<string | ArrayBuffer | null>(null);
    const [previewType, setPreviewType] = useState<'html' | 'pdf' | 'text' | null>(null);
    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
    const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

    const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.API_KEY as string }), []);

    useEffect(() => {
        if (!firebaseInitialized || !auth) {
            setIsAuthLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setUser(user);
            if (user && db) {
                const userDocRef = doc(db, 'users', user.uid);
                try {
                    const docSnap = await getDoc(userDocRef);
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        setSavedJobs(data?.savedJobs || []);
                        setUserProfile(prevProfile => ({...defaultUserProfile, ...data?.userProfile}));
                    } else {
                        await setDoc(userDocRef, { savedJobs: [], userProfile: defaultUserProfile });
                    }
                } catch (e) {
                    console.error("Error fetching user data from Firestore:", e);
                    setError("Could not load your profile data.");
                }
            } else {
                setSavedJobs([]);
                setUserProfile(defaultUserProfile);
            }
            setIsAuthLoading(false);
        });

        // Handle sign-in redirect errors
        const handleRedirectResult = async () => {
            if (!auth) return;
            try {
                await getRedirectResult(auth);
            } catch (error) {
                console.error("Firebase redirect result error:", error);
                setError("Failed to complete sign-in. Please try again.");
            }
        };
        handleRedirectResult();

        return () => unsubscribe();
    }, [firebaseInitialized]);


    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };
    
    const clearFile = () => {
        setResumeText('');
        setPreviewContent(null);
        setPreviewType(null);
        setUploadedFileName(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setError(null);
        setResumeText('');
        setPreviewContent(null);
        setPreviewType(null);
        setActiveTab('text');
        setIsGeneratingPreview(true);
        setUploadedFileName(file.name);

        try {
            const extension = file.name.split('.').pop()?.toLowerCase();
            let text = '';
            const arrayBuffer = await file.arrayBuffer();

            if (extension === 'txt' || extension === 'md') {
                text = await new Blob([arrayBuffer]).text();
                if (extension === 'md') {
                    setPreviewContent(await marked(text));
                    setPreviewType('html');
                } else {
                    setPreviewContent(text);
                    setPreviewType('text');
                }
            } else if (extension === 'docx') {
                const resultText = await mammoth.extractRawText({ arrayBuffer });
                text = resultText.value;
                const resultHtml = await mammoth.convertToHtml({ arrayBuffer });
                setPreviewContent(resultHtml.value);
                setPreviewType('html');
            } else if (extension === 'pdf') {
                const pdf = await pdfjsLib.getDocument(arrayBuffer.slice(0)).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
                    fullText += pageText + '\n';
                }
                text = fullText;
                setPreviewContent(arrayBuffer);
                setPreviewType('pdf');
            } else {
                throw new Error('Unsupported file type. Please upload a .txt, .md, .pdf, or .docx file.');
            }

            setResumeText(text);
            setActiveTab('preview');

        } catch (e) {
            console.error('Error reading file:', e);
            const message = e instanceof Error ? e.message : 'Failed to read the file. Please try another file.';
            setError(message);
            setUploadedFileName(null);
        } finally {
            setIsGeneratingPreview(false);
            if (event.target) event.target.value = '';
        }
    };


    const handleAnalyze = async () => {
        if (!resumeText.trim()) return;

        setStep('analyzing');
        setError(null);
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
                    experienceLevel: { type: Type.STRING, description: "Estimate the candidate's experience level (e.g., 'Entry-Level', 'Mid-Level', 'Senior', 'Executive')." },
                    improvementSuggestions: { type: Type.STRING, description: "2-3 actionable bullet points ('*') on improving the resume." }
                },
                required: ["summary", "skills", "role", "atsScore", "experienceLevel", "improvementSuggestions"]
            };

            const response = await ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: `Analyze this resume: \n\n${resumeText}`,
                config: { responseMimeType: "application/json", responseSchema: analysisSchema },
            });

            const resultJson = JSON.parse(response.text) as AnalysisResult;
            setAnalysisResult(resultJson);
            setExperienceLevel(resultJson.experienceLevel);
            setStep('analysis_result');

        } catch (e: any) {
            console.error('Analysis Error:', e);
            const analysisError = `Analysis failed: ${e.message}.`;
            setError(analysisError);
            setStep('input');
        }
    };

    const generateJobSearchPrompt = (findMore = false, currentJobs: Job[] = [], feedback: Record<string, 'like' | 'dislike'> = {}, saved: Job[] = []) => {
        if (!analysisResult) return '';

        let profilePromptSection = '';
        const hasProfile = userProfile.preferredTitles || userProfile.minSalary || userProfile.maxSalary || userProfile.careerGoals || userProfile.locationPreference;
        if (hasProfile) {
            const minSal = userProfile.minSalary ? `₹${Number(userProfile.minSalary).toLocaleString('en-IN')}` : '';
            const maxSal = userProfile.maxSalary ? `₹${Number(userProfile.maxSalary).toLocaleString('en-IN')}` : '';
            const salaryRange = [minSal, maxSal].filter(Boolean).join(' - ');

            profilePromptSection = `
            
            Candidate's Career Profile for Personalization:
            - Preferred Job Titles: ${userProfile.preferredTitles || 'Not specified'}
            - Preferred Locations: ${userProfile.locationPreference || 'Not specified'}
            - Desired Annual Salary Range (INR): ${salaryRange || 'Not specified'}
            - Career Goals: ${userProfile.careerGoals || 'Not specified'}

            Use this profile to further refine the job search. Prioritize roles matching the preferred titles and locations. Consider the salary range and career goals when evaluating relevance.
            `;
        }
        
        const likedJobs = new Map<string, Job>();
        currentJobs.forEach(job => {
            if (feedback[job.applyLink] === 'like') {
                likedJobs.set(job.applyLink, job);
            }
        });
        saved.forEach(job => {
            likedJobs.set(job.applyLink, job);
        });
        const dislikedJobs = currentJobs.filter(job => feedback[job.applyLink] === 'dislike');

        let feedbackPromptSection = '';
        if (likedJobs.size > 0) {
            const likedJobsList = Array.from(likedJobs.values()).map(job => `- ${job.title} at ${job.company}`).join('\n');
            feedbackPromptSection += `
            
            The user has shown POSITIVE interest in these jobs. Find more opportunities with similar titles, skills, and companies:
            ${likedJobsList}
            `;
        }
        if (dislikedJobs.length > 0) {
            const dislikedJobsList = dislikedJobs.map(job => `- ${job.title} at ${job.company}`).join('\n');
            feedbackPromptSection += `
            
            The user has shown NEGATIVE interest in these jobs. AVOID suggesting roles with similar titles and descriptions:
            ${dislikedJobsList}
            `;
        }

        let existingJobsSection = '';
        if (findMore && jobsResult && jobsResult.jobs.length > 0) {
            const existingJobTitles = jobsResult.jobs.map(job => `- ${job.title} at ${job.company}`).join('\n');
            existingJobsSection = `
            
            IMPORTANT: You have already shown the user the following jobs. Provide a list of NEW jobs that are NOT in the list below:
            ${existingJobTitles}
            `;
        }

        return `Based on this resume analysis, find 10 relevant and recent job openings in India.
        Analysis:
        - Ideal Role: ${analysisResult.role}
        - Key Skills: ${analysisResult.skills.map(s => s.skillName).join(', ')}
        - Candidate Summary: ${analysisResult.summary}
        
        Job Search Preferences:
        - Experience Level: ${experienceLevel}
        - Preferred Companies: ${preferredCompanies.trim() ? preferredCompanies.trim() : 'Any'}
        ${profilePromptSection}
        ${feedbackPromptSection}
        Prioritize jobs that closely match the specified experience level and ideal role. If preferred companies are listed, heavily weigh results from those companies, but also include other relevant opportunities. Use the key skills and summary for keyword matching.
        ${existingJobsSection}
        IMPORTANT: Return a JSON object inside a markdown block (\`\`\`json ... \`\`\`). The JSON object must have one key "jobs", an array of objects. Each object must have keys: "title", "company", "location", "description" (1-2 sentences), "applyLink" (a direct URL to the application page), "sourceUrl" (the URL of the page where the job was found), and "datePosted" (the estimated posting date in "YYYY-MM-DD" format).`;
    };

    const handleFindJobs = async () => {
        if (!analysisResult) return;
        setStep('finding_jobs');
        setError(null);
        setJobsResult(null);

        try {
            const prompt = generateJobSearchPrompt(false, [], {}, savedJobs);
            const response = await ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: prompt,
                config: { tools: [{ googleSearch: {} }] },
            });

            const text = response.text;

            const jsonBlockMatch = text.match(/```json\n([\s\S]*?)\n```/);
            if (!jsonBlockMatch || !jsonBlockMatch[1]) {
                throw new Error("AI response did not contain a valid JSON job list.");
            }

            const jsonString = jsonBlockMatch[1];
            const resultJson = JSON.parse(jsonString) as JobResult;

            setJobsResult({ jobs: resultJson.jobs || [] });
            setStep('jobs_result');

        } catch (e: any) {
            console.error('Job Search Error:', e);
            const jobError = `Job search failed: ${e.message}.`;
            setError(jobError);
            setStep('analysis_result');
        }
    };

    const handleFindMoreJobs = async () => {
        if (!analysisResult) return;
        setIsFindingMoreJobs(true);
        setError(null);

        try {
            const prompt = generateJobSearchPrompt(true, jobsResult?.jobs || [], jobFeedback, savedJobs);
            const response = await ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: prompt,
                config: { tools: [{ googleSearch: {} }] },
            });

            const text = response.text;
            const jsonBlockMatch = text.match(/```json\n([\s\S]*?)\n```/);
            if (!jsonBlockMatch || !jsonBlockMatch[1]) {
                throw new Error("AI response did not contain a valid JSON job list.");
            }
            const jsonString = jsonBlockMatch[1];
            const resultJson = JSON.parse(jsonString) as JobResult;
            const newJobs = resultJson.jobs || [];

            if (newJobs.length > 0) {
                setJobsResult(prev => ({
                    jobs: [...(prev?.jobs || []), ...newJobs]
                }));
            }
        } catch (e: any) {
            console.error('Find More Jobs Error:', e);
            const findMoreError = `Finding more jobs failed: ${e.message}.`;
            setError(findMoreError);
        } finally {
            setIsFindingMoreJobs(false);
        }
    };
    
    const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const isCheckbox = type === 'checkbox';

        setUserProfile(prev => ({
            ...prev,
            [name]: isCheckbox ? (e.target as HTMLInputElement).checked : value
        }));
    };

    const handleSaveProfile = async () => {
        if (!user || !db) {
            setError("You must be signed in to save your profile.");
            return;
        }
        try {
            await setDoc(doc(db, 'users', user.uid), { userProfile }, { merge: true });
            setProfileSaved(true);
            setTimeout(() => setProfileSaved(false), 2000); // Hide message after 2s
        } catch (e) {
            console.error("Error saving profile:", e);
            setError("Failed to save profile. Please try again.");
        }
    };


    const toggleSaveJob = (jobToToggle: Job) => {
        if (!user) {
            setError("Please sign in to save jobs.");
            return;
        }

        let updatedSavedJobs;
        if (savedJobs.some(job => job.applyLink === jobToToggle.applyLink)) {
            updatedSavedJobs = savedJobs.filter(job => job.applyLink !== jobToToggle.applyLink);
        } else {
            updatedSavedJobs = [...savedJobs, jobToToggle];
        }
        setSavedJobs(updatedSavedJobs);

        if (db && user) {
            setDoc(doc(db, 'users', user.uid), { savedJobs: updatedSavedJobs }, { merge: true })
                .catch(e => {
                    console.error("Error saving job to Firestore:", e);
                    setError("Could not save job. Please try again.");
                    setSavedJobs(savedJobs);
                });
        }
    };
    
    const handleJobFeedback = (jobToUpdate: Job, newFeedback: 'like' | 'dislike') => {
        const { applyLink } = jobToUpdate;
        setJobFeedback(prev => {
            const currentFeedback = prev[applyLink];
            const updatedFeedback = { ...prev };

            if (currentFeedback === newFeedback) {
                delete updatedFeedback[applyLink];
            } else {
                updatedFeedback[applyLink] = newFeedback;
            }
            return updatedFeedback;
        });
    };

    const sortedAndFilteredJobs = useMemo(() => {
        if (!jobsResult?.jobs) return [];
        let jobs = [...jobsResult.jobs];

        if (locationFilter.trim()) {
            jobs = jobs.filter(job => job.location.toLowerCase().includes(locationFilter.toLowerCase()));
        }

        if (jobSortOrder === 'date') {
            jobs.sort((a, b) => {
                const dateA = a.datePosted ? new Date(a.datePosted).getTime() : 0;
                const dateB = b.datePosted ? new Date(b.datePosted).getTime() : 0;
                return dateB - dateA;
            });
        }

        return jobs;
    }, [jobsResult, locationFilter, jobSortOrder]);

    const handleSignIn = async () => {
        if (!auth) {
            setError("Authentication service is not available. Please check your configuration.");
            return;
        }
        setIsAuthLoading(true);
        const provider = new GoogleAuthProvider();
        try {
            await signInWithRedirect(auth, provider);
        } catch (error) {
            console.error("Authentication error:", error);
            setError("Failed to start sign in process. Please try again.");
            setIsAuthLoading(false);
        }
    };

    const handleSignOut = async () => {
        if (!auth) return;
        setIsAuthLoading(true);
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Sign out error:", error);
            setError("Failed to sign out.");
            setIsAuthLoading(false);
        }
    };

    const renderSavedJobs = () => (
        <section className="my-saved-jobs">
            <h2>My Saved Jobs</h2>
            <div className="button-group" style={{ justifyContent: 'flex-start', marginBottom: '2rem' }}>
                <button onClick={() => setCurrentView('main')} className="button button-secondary">
                    <span className="material-icons">arrow_back</span>
                    Back to Main
                </button>
            </div>
            {savedJobs.length > 0 ? (
                <div className="job-listings">
                    {savedJobs.map((job, index) => (
                        <JobCard
                            key={`${job.applyLink}-${index}`}
                            job={job}
                            cardIndex={index}
                            isSaved={true}
                            onToggleSave={() => toggleSaveJob(job)}
                        />
                    ))}
                </div>
            ) : (
                <div className="card">
                    <p>You haven't saved any jobs yet. Go find some!</p>
                </div>
            )}
        </section>
    );


    const renderContent = () => {
        switch (step) {
            case 'analyzing':
            case 'finding_jobs':
                return (
                    <div className="loader card">
                        <div className="spinner"></div>
                        <p>{step === 'analyzing' ? 'Analyzing your resume...' : 'Finding job opportunities...'}</p>
                    </div>
                );
            case 'analysis_result':
                return analysisResult && (
                    <div className="analysis-results">
                        <div className="results-card card">
                             <h3>AI Summary</h3>
                             <p>{analysisResult.summary}</p>
                             <p>Suggested Role: <strong className="role-suggestion">{analysisResult.role}</strong></p>
                        </div>
                         <div className="analysis-grid">
                            <div className="results-card card">
                                <h3>Top Skills Analysis</h3>
                                <SkillsChart skills={analysisResult.skills} />
                            </div>
                            <div className="results-card card" style={{textAlign: 'center'}}>
                                <h3>ATS Score</h3>
                                <div className="ats-score-circle" style={{ background: `conic-gradient(var(--primary-color) ${analysisResult.atsScore * 3.6}deg, #e5e7eb 0deg)` }}>
                                    {analysisResult.atsScore}
                                </div>
                                <p>An estimate of your resume's compatibility with automated screening systems.</p>
                            </div>
                        </div>
                        <div className="results-card card">
                            <h3>Improvement Suggestions</h3>
                            <div dangerouslySetInnerHTML={{ __html: marked.parse(analysisResult.improvementSuggestions) }}></div>
                        </div>
                        
                        <div className="profile-section card">
                            <details open>
                                <summary>
                                    My Career Profile
                                    <span className="summary-icon material-icons">expand_more</span>
                                </summary>
                                <div className="profile-form">
                                    <p className="form-description">Personalize your job search. This information will be used by the AI to find better matches for you.</p>

                                    <div className="form-grid">
                                        <div className="form-group">
                                            <label htmlFor="preferredTitles">Preferred Job Titles</label>
                                            <input type="text" id="preferredTitles" name="preferredTitles" value={userProfile.preferredTitles} onChange={handleProfileChange} placeholder="e.g., Senior Software Engineer" />
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="locationPreference">Preferred Location(s)</label>
                                            <input type="text" id="locationPreference" name="locationPreference" value={userProfile.locationPreference} onChange={handleProfileChange} placeholder="e.g., Bangalore, Remote" />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label>Desired Annual Salary (INR)</label>
                                        <div className="salary-inputs">
                                            <input type="number" name="minSalary" value={userProfile.minSalary} onChange={handleProfileChange} placeholder="₹ Minimum" aria-label="Minimum salary" />
                                            <span>-</span>
                                            <input type="number" name="maxSalary" value={userProfile.maxSalary} onChange={handleProfileChange} placeholder="₹ Maximum" aria-label="Maximum salary" />
                                        </div>
                                    </div>
                                    
                                    <div className="form-group" style={{marginTop: '1.5rem'}}>
                                        <label htmlFor="careerGoals">Career Goals</label>
                                        <textarea id="careerGoals" name="careerGoals" value={userProfile.careerGoals} onChange={handleProfileChange} rows={3} placeholder="e.g., Transition into a leadership role..."></textarea>
                                    </div>
                                    
                                     <div className={`job-alerts-section ${userProfile.jobAlertsEnabled ? 'active' : ''}`}>
                                        <div className="form-group">
                                            <label>Email Job Alerts</label>
                                            <div className="alert-controls">
                                                <p className="form-description" style={{ marginBottom: 0 }}>Get new jobs matching your profile sent to your inbox.</p>
                                                <div className="alert-options">
                                                     <label className="toggle-switch">
                                                        <input type="checkbox" name="jobAlertsEnabled" checked={userProfile.jobAlertsEnabled} onChange={handleProfileChange} />
                                                        <span className="toggle-slider"></span>
                                                    </label>
                                                    <div className="form-group" style={{marginBottom: 0}}>
                                                         <select name="jobAlertsFrequency" value={userProfile.jobAlertsFrequency} onChange={handleProfileChange} disabled={!userProfile.jobAlertsEnabled}>
                                                            <option value="daily">Daily</option>
                                                            <option value="weekly">Weekly</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>


                                    <div className="button-group profile-actions">
                                        <button onClick={handleSaveProfile} className="button button-secondary" disabled={!user}>
                                            <span className="material-icons">{profileSaved ? 'check_circle' : 'save'}</span>
                                            {profileSaved ? (userProfile.jobAlertsEnabled ? 'Alerts Activated!' : 'Profile Saved!') : 'Save Profile'}
                                        </button>
                                        {!user && <p className="sign-in-prompt">Sign in to save your profile.</p>}
                                    </div>
                                </div>
                            </details>
                        </div>

                        <div className="button-group">
                            <button onClick={handleFindJobs} className="button button-primary">Find Jobs for Me</button>
                        </div>
                    </div>
                );
            case 'jobs_result':
                 return jobsResult && (
                    <div className="results-section">
                        <h2>Your Curated Job Openings</h2>
                        <div className="job-listings">
                            {sortedAndFilteredJobs.map((job, index) => (
                                <JobCard
                                    key={`${job.applyLink}-${index}`}
                                    job={job}
                                    cardIndex={index}
                                    isSaved={savedJobs.some(saved => saved.applyLink === job.applyLink)}
                                    onToggleSave={() => toggleSaveJob(job)}
                                    feedback={jobFeedback[job.applyLink] || null}
                                    onLike={() => handleJobFeedback(job, 'like')}
                                    onDislike={() => handleJobFeedback(job, 'dislike')}
                                />
                            ))}
                        </div>
                        <div className="button-group">
                             <button onClick={handleFindMoreJobs} className="button button-secondary" disabled={isFindingMoreJobs}>
                                {isFindingMoreJobs ? 'Searching...' : 'Find More Jobs'}
                            </button>
                        </div>
                    </div>
                 );
            case 'input':
            default:
                return (
                    <>
                        <section className="hero-section">
                            <h1>Unlock Your Career Potential</h1>
                            <p>Upload your resume, and our AI will analyze your skills, suggest improvements, and find the perfect job matches for you in India.</p>
                        </section>
                        <div className="card">
                            {uploadedFileName ? (
                                <div className="file-preview-card">
                                    <div className="file-info-bar">
                                        <div className="file-name">
                                            <span className="material-icons">description</span>
                                            <span>{uploadedFileName}</span>
                                        </div>
                                        <div className="tabs">
                                            <button className={`tab-button ${activeTab === 'text' ? 'active' : ''}`} onClick={() => setActiveTab('text')}>Raw Text</button>
                                            <button className={`tab-button ${activeTab === 'preview' ? 'active' : ''}`} onClick={() => setActiveTab('preview')}>Preview</button>
                                        </div>
                                        <button onClick={clearFile} className="clear-file-button" aria-label="Clear file">
                                            <span className="material-icons">close</span>
                                        </button>
                                    </div>
                                    <div className="tab-content">
                                        {activeTab === 'text' ?
                                            <textarea value={resumeText} readOnly /> :
                                            <div className="preview-container">
                                                {isGeneratingPreview ? <div className="loader"><div className="spinner"></div></div> : <PreviewRenderer content={previewContent} type={previewType} />}
                                            </div>
                                        }
                                    </div>
                                </div>
                            ) : (
                                <div className="resume-input">
                                    <textarea
                                        placeholder="Or paste your resume here..."
                                        value={resumeText}
                                        onChange={(e) => setResumeText(e.target.value)}
                                        aria-label="Resume text input"
                                    />
                                </div>
                            )}

                            <div className="button-group">
                                <button onClick={handleUploadClick} className="button button-secondary">
                                    <span className="material-icons">upload_file</span>
                                    Upload Resume
                                </button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    style={{ display: 'none' }}
                                    onChange={handleFileChange}
                                    accept=".txt,.md,.pdf,.docx"
                                />
                                <button onClick={handleAnalyze} disabled={!resumeText.trim()} className="button button-primary">
                                    Analyze Resume
                                    <span className="material-icons">arrow_forward</span>
                                </button>
                            </div>
                             {error && <div className="error-message">{error}</div>}
                        </div>
                    </>
                );
        }
    };


    return (
        <>
        <header className="app-header">
            <a href="/" className="logo">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 7L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 22V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 7L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M17 4.5L7 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span>Resumate</span>
            </a>
             <div className="auth-controls">
                {isAuthLoading ? (
                    <div className="spinner small" aria-label="Loading authentication status"></div>
                ) : user ? (
                    <>
                        {savedJobs.length > 0 && currentView === 'main' && (
                            <button onClick={() => setCurrentView('saved_jobs')} className="button button-secondary saved-jobs-button">
                                <span className="material-icons">bookmark</span>
                                <span className="saved-jobs-text">Saved</span>
                                <span className="saved-jobs-count">{savedJobs.length}</span>
                            </button>
                        )}
                        <div className="user-info">
                            <img src={user.photoURL || undefined} alt="User avatar" className="avatar" />
                            <span className="user-name">{user.displayName}</span>
                            <button onClick={handleSignOut} className="button button-secondary">Sign Out</button>
                        </div>
                    </>
                ) : (
                    <button onClick={handleSignIn} className="button button-primary" disabled={!firebaseInitialized}>Sign In</button>
                )}
            </div>
        </header>
        <main className="container">
            {firebaseError && <div className="error-message persistent-error">{firebaseError}</div>}
            {currentView === 'main' ? renderContent() : renderSavedJobs()}
        </main>
        </>
    );
};

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);