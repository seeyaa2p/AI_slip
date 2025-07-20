import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// Recharts components for charting
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';

// Firebase imports
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, query, onSnapshot, deleteDoc, getDocs } from 'firebase/firestore'; // Added getDocs

// Main App Component
const App = () => {
    // State variables for managing the application's data and UI
    const [selectedImages, setSelectedImages] = useState([]); // Stores uploaded images as an array of objects {id, dataUrl}
    const [extractedData, setExtractedData] = useState([]); // Stores extracted data for multiple slips as an array
    const [loading, setLoading] = useState(false); // Indicates if AI is processing
    const [error, setError] = useState(null); // Stores any error messages
    const [isDragOver, setIsDragOver] = useState(false); // For drag-and-drop UI
    const [showCsvPreview, setShowCsvPreview] = useState(false); // State to control CSV preview modal visibility
    const [csvContentForPreview, setCsvContentForPreview] = useState(''); // Stores the CSV string for preview
    const [fileInputKey, setFileInputKey] = useState(0); // Key to force re-render of file input for reset
    const canvasRef = useRef(null); // Reference to the canvas element for background animation
    const [searchQuery, setSearchQuery] = useState(''); // New state for search query

    // New state for image pop-up modal
    const [showImageModal, setShowImageModal] = useState(false);
    const [currentImageModalUrl, setCurrentImageModalUrl] = useState(null);

    // Set showExtractedDataTable to true by default to always show the table
    const [showExtractedDataTable, setShowExtractedDataTable] = useState(true); // Changed default to true

    // Firebase state
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // Utility function to introduce a delay
    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    // Initialize Firebase and set up auth listener
    useEffect(() => {
        try {
            const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);

            setDb(firestoreDb);
            setAuth(firebaseAuth);

            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    // Sign in anonymously if no user is authenticated
                    if (typeof __initial_auth_token !== 'undefined') {
                        await signInWithCustomToken(firebaseAuth, __initial_auth_token);
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                    setUserId(firebaseAuth.currentUser?.uid || crypto.randomUUID()); // Fallback for anonymous
                }
                setIsAuthReady(true);
            });

            return () => unsubscribe();
        } catch (e) {
            console.error("Firebase initialization error:", e);
            setError("Failed to initialize Firebase. Data persistence may not work.");
        }
    }, []);

    // Load data from Firestore when auth is ready and userId is set
    useEffect(() => {
        if (!db || !userId || !isAuthReady) return;

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const slipsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/slips`);
        const q = query(slipsCollectionRef); // Removed orderBy, as it can cause issues without indexes

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const loadedData = [];
            const loadedImages = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.id && data.dataUrl) {
                    loadedImages.push({ id: data.id, dataUrl: data.dataUrl, timestamp: data.timestamp }); // Include timestamp
                    if (data.extractedData) {
                        loadedData.push({ imageId: data.id, data: data.extractedData });
                    }
                }
            });
            // Sort loadedImages and loadedData by timestamp for consistent display order
            loadedImages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            loadedData.sort((a, b) => {
                const imgA = loadedImages.find(img => img.id === a.imageId);
                const imgB = loadedImages.find(img => img.id === b.imageId);
                return ((imgA?.timestamp || 0) - (imgB?.timestamp || 0));
            });

            setSelectedImages(loadedImages);
            setExtractedData(loadedData);
        }, (err) => {
            console.error("Error fetching data from Firestore:", err);
            setError("Failed to load saved data. Please check console for details.");
        });

        return () => unsubscribe();
    }, [db, userId, isAuthReady]);


    // Function to handle image file selection
    const handleImageChange = (event) => {
        const files = Array.from(event.target.files);
        processFiles(files);
    };

    // Function to process files from input or drag-and-drop
    const processFiles = useCallback(async (files) => {
        if (!db || !userId) {
            setError('Firebase not initialized or user not authenticated. Please wait.');
            return;
        }

        let hasError = false;

        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                setError('กรุณาอัปโหลดไฟล์รูปภาพเท่านั้น');
                hasError = true;
                continue;
            }

            const reader = new FileReader();
            reader.readAsDataURL(file);

            await new Promise(resolve => {
                reader.onloadend = async () => {
                    const uniqueId = crypto.randomUUID();
                    const imageDataUrl = reader.result;

                    // Save image Data URL to Firestore
                    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
                    const slipDocRef = doc(db, `artifacts/${appId}/users/${userId}/slips`, uniqueId);

                    try {
                        await setDoc(slipDocRef, {
                            id: uniqueId,
                            dataUrl: imageDataUrl,
                            timestamp: Date.now(), // Add timestamp for ordering
                            extractedData: null // Initialize with null, will be updated later
                        });
                        // Introduce a small delay after each write
                        await delay(100);
                        // Do NOT update selectedImages here directly. onSnapshot will handle it.
                    } catch (e) {
                        console.error("Error saving image to Firestore:", e);
                        setError("Failed to save some images to database. Check image size (max 1MB per image).");
                        hasError = true;
                    }
                    resolve();
                };
            });
        }

        if (hasError) {
            // If any error occurred, clear file input (state will be updated by onSnapshot)
            setFileInputKey(prevKey => prevKey + 1);
        }
        setError(null); // Clear general error after processing files
    }, [db, userId]);


    // Function to remove a specific image by its ID
    const removeImage = useCallback(async (idToRemove) => {
        if (!db || !userId) {
            setError('Firebase not initialized or user not authenticated.');
            return;
        }
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const slipDocRef = doc(db, `artifacts/${appId}/users/${userId}/slips`, idToRemove);
        try {
            await deleteDoc(slipDocRef);
            // State updates will be handled by the onSnapshot listener
        } catch (e) {
            console.error("Error deleting image from Firestore:", e);
            setError("Failed to delete image from database.");
        }
    }, [db, userId]);

    // Function to handle drag over event for file drop zone
    const handleDragOver = (event) => {
        event.preventDefault();
        setIsDragOver(true);
    };

    // Function to handle drag leave event for file drop zone
    const handleDragLeave = () => {
        setIsDragOver(false);
    };

    // Function to handle file drop event for file drop zone
    const handleDrop = (event) => {
        event.preventDefault();
        setIsDragOver(false);
        const files = Array.from(event.dataTransfer.files); // Convert FileList to Array
        processFiles(files);
    };

    // Function to generate CSV string from extracted data
    const generateCsv = (data) => {
        // Get the current Canvas URL to construct the image viewer link
        const currentBaseUrl = window.location.origin + window.location.pathname;
        // Assuming the image viewer HTML is in the same directory or a known path
        const viewerUrlBase = currentBaseUrl.replace(/\/[^/]*$/, '/image_viewer.html'); // Adjust if image_viewer.html is in a subfolder

        // Updated headers to include both sender and recipient bank names
        const headers = [
            "Image ID", "View Image URL", "ชื่อผู้ส่ง", "ชื่อผู้รับ", "จำนวนเงิน", "วันที่ทำรายการ",
            "เวลาทำรายการ", "รหัสอ้างอิงการทำรายการ", "ชื่อธนาคารต้นทาง",
            "เลขบัญชีต้นทาง", "ชื่อธนาคารปลายทาง", "เลขบัญชีปลายทาง", "ประเทศ"
        ];

        const csvRows = [];
        csvRows.push(headers.join(','));

        data.forEach(item => {
            const row = [];
            const viewImageUrl = `${viewerUrlBase}?imageId=${item.imageId}&appId=${typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'}&userId=${userId}`;

            row.push(item.imageId || '');
            row.push(viewImageUrl); // Add the URL to view the image
            row.push(item.data.senderName || '');
            row.push(item.data.recipientName || '');
            row.push(item.data.amount || '');
            row.push(item.data.transactionDate || '');
            row.push(item.data.transactionTime || '');
            row.push(item.data.transactionId || '');
            row.push(item.data.senderBankName || ''); // Use senderBankName
            row.push(item.data.senderBankAccountNumber || '');
            row.push(item.data.recipientBankName || ''); // Use recipientBankName
            row.push(item.data.recipientBankAccountNumber || '');
            row.push(item.data.country || '');
            csvRows.push(row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','));
        });

        return csvRows.join('\n');
    };

    // Function to handle CSV download
    const handleDownloadCsv = () => {
        const csvString = csvContentForPreview;
        const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'slip_data.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setShowCsvPreview(false);
    };

    // Function to process and extract data for all selected images using Gemini API
    const processSlipWithAI = useCallback(async () => {
        if (selectedImages.length === 0) {
            setError('กรุณาอัปโหลดรูปภาพสลิปโอนเงินก่อน');
            return;
        }
        if (!db || !userId) {
            setError('Firebase not initialized or user not authenticated. Please wait.');
            return;
        }

        setLoading(true);
        setError(null);
        // Do not clear extractedData here, as we will update existing Firestore docs
        setCsvContentForPreview('');
        setShowCsvPreview(false);

        const updatedExtractedData = [];
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

        for (const imageObj of selectedImages) {
            // Check if this image already has extracted data
            const existingExtracted = extractedData.find(item => item.imageId === imageObj.id);
            if (existingExtracted && existingExtracted.data) {
                // If already extracted, just add to updated list and skip AI processing
                updatedExtractedData.push(existingExtracted);
                continue;
            }

            try {
                const base64ImageData = imageObj.dataUrl.split(',')[1];
                const prompt = `
                    โปรดดึงข้อมูลต่อไปนี้จากสลิปโอนเงินที่ให้มา:
                    - ชื่อผู้ส่ง (Sender Name)
                    - ชื่อผู้รับ (Recipient Name)
                    - จำนวนเงิน (Amount)
                    - วันที่ทำรายการ (Transaction Date)
                    - เวลาทำรายการ (Transaction Time)
                    - รหัสอ้างอิงการทำรายการ (Transaction ID) - ถ้ามี
                    - ชื่อธนาคารต้นทาง (Sender Bank Name) - ถ้ามี
                    - เลขบัญชีต้นทาง (Sender Bank Account Number) - ถ้ามี
                    - ชื่อธนาคารปลายทาง (Recipient Bank Name) - ถ้ามี
                    - เลขบัญชีปลายทาง (Recipient Bank Account Number) - ถ้ามี
                    - ประเทศ (Country) - ถ้ามี

                    โปรดตอบกลับเป็น JSON ตาม schema ที่กำหนดเท่านั้น
                `;

                let chatHistory = [];
                chatHistory.push({
                    role: "user",
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: "image/png",
                                data: base64ImageData
                            }
                        }
                    ]
                });

                const payload = {
                    contents: chatHistory,
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "OBJECT",
                            properties: {
                                "senderName": { "type": "STRING" },
                                "recipientName": { "type": "STRING" },
                                "amount": { "type": "STRING" },
                                "transactionDate": { "type": "STRING" },
                                "transactionTime": { "type": "STRING" },
                                "transactionId": { "type": "STRING", "nullable": true },
                                "senderBankName": { "type": "STRING", "nullable": true }, // New field
                                "senderBankAccountNumber": { "type": "STRING", "nullable": true },
                                "recipientBankName": { "type": "STRING", "nullable": true }, // New field
                                "recipientBankAccountNumber": { "type": "STRING", "nullable": true },
                                "country": { "type": "STRING", "nullable": true }
                            },
                            "propertyOrdering": [
                                "senderName", "recipientName", "amount", "transactionDate",
                                "transactionTime", "transactionId", "senderBankName",
                                "senderBankAccountNumber", "recipientBankName", "recipientBankAccountNumber", "country"
                            ]
                        }
                    }
                };

                const apiKey = "";
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (result.candidates && result.candidates.length > 0 &&
                    result.candidates[0].content && result.candidates[0].content.parts &&
                    result.candidates[0].content.parts.length > 0) {
                    const jsonText = result.candidates[0].content.parts[0].text;
                    try {
                        const parsedJson = JSON.parse(jsonText);
                        const parsedAmount = parseFloat(parsedJson.amount?.replace(/[^0-9.-]+/g,"") || '0');
                        const extracted = { ...parsedJson, parsedAmount };

                        // Update Firestore document with extracted data
                        const slipDocRef = doc(db, `artifacts/${appId}/users/${userId}/slips`, imageObj.id);
                        await setDoc(slipDocRef, { extractedData: extracted }, { merge: true });
                        // Introduce a small delay after each write
                        await delay(100);

                        updatedExtractedData.push({ imageId: imageObj.id, data: extracted });
                    } catch (parseError) {
                        console.error('JSON parsing error for an image:', parseError);
                        console.error('Raw AI response for image:', jsonText);
                        setError('ไม่สามารถแยกวิเคราะห์ข้อมูลที่ได้รับจาก AI สำหรับบางรูปภาพได้');
                    }
                } else {
                    console.error('Unexpected AI response structure for an image:', result);
                    setError('ไม่ได้รับข้อมูลที่ถูกต้องจาก AI สำหรับบางรูปภาพ โปรดลองอีกครั้ง');
                }
            } catch (err) {
                console.error('API call error for an image:', err);
                setError('เกิดข้อผิดพลาดในการประมวลผลสำหรับบางรูปภาพ: ' + err.message);
            }
        }
        setExtractedData(updatedExtractedData); // This will trigger re-render and update the UI

        if (updatedExtractedData.length > 0) {
            const csv = generateCsv(updatedExtractedData);
            setCsvContentForPreview(csv);
            setShowCsvPreview(true);
        }

        setLoading(false);
    }, [selectedImages, db, userId, extractedData]); // Added extractedData to dependency array

    // Function to open image modal
    const openImageModal = useCallback((imageId) => {
        const image = selectedImages.find(img => img.id === imageId);
        if (image) {
            setCurrentImageModalUrl(image.dataUrl);
            setShowImageModal(true);
        }
    }, [selectedImages]);

    // Effect hook for canvas background animation
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let particles = [];
        const numParticles = 200;
        const particleColor = 'rgba(255, 255, 255, 0.9)';
        const lineColor = 'rgba(150, 150, 255, 0.1)';

        const setCanvasDimensions = () => {
            canvas.width = window.innerWidth;
            canvas.height = document.body.scrollHeight > window.innerHeight ? document.body.scrollHeight : window.innerHeight;
        };

        function Particle(x, y, radius, dx, dy) {
            this.x = x;
            this.y = y;
            this.radius = radius;
            this.dx = dx;
            this.dy = dy;

            this.draw = function() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2, false);
                ctx.fillStyle = particleColor;
                ctx.fill();
            };

            this.update = function() {
                if (this.x + this.radius > canvas.width || this.x - this.radius < 0) {
                    this.dx = -this.dx;
                }
                if (this.y + this.radius > canvas.height || this.y - this.radius < 0) {
                    this.dy = -this.dy;
                }

                this.x += this.dx;
                this.y += this.dy;

                this.draw();
            };
        }

        const initParticles = () => {
            particles = [];
            for (let i = 0; i < numParticles; i++) {
                const radius = Math.random() * 1.5 + 0.5;
                const x = Math.random() * (canvas.width - radius * 2) + radius;
                const y = Math.random() * (canvas.height - radius * 2) + radius;
                const dx = (Math.random() - 0.5) * 0.2;
                const dy = (Math.random() - 0.5) * 0.2;
                particles.push(new Particle(x, y, radius, dx, dy));
            }
        };

        const connectParticles = () => {
            for (let i = 0; i < particles.length; i++) {
                for (let j = i; j < particles.length; j++) {
                    const p1 = particles[i];
                    const p2 = particles[j];
                    const distance = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

                    if (distance < 120) {
                        ctx.beginPath();
                        ctx.moveTo(p1.x, p1.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.strokeStyle = lineColor;
                        ctx.lineWidth = 0.3;
                        ctx.stroke();
                    }
                }
            }
        };

        const animateParticles = () => {
            requestAnimationFrame(animateParticles);

            const gradient = ctx.createRadialGradient(
                canvas.width / 2, canvas.height / 2, 0,
                canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) / 2
            );
            gradient.addColorStop(0, 'rgba(10, 0, 30, 0.8)');
            gradient.addColorStop(0.5, 'rgba(0, 0, 20, 0.9)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);


            for (let i = 0; i < particles.length; i++) {
                particles[i].update();
            }
            connectParticles();
        };

        setCanvasDimensions();
        initParticles();
        animateParticles();

        const handleResize = () => {
            setCanvasDimensions();
            initParticles();
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    // Calculate dashboard summary data
    const totalSlips = extractedData.length;
    const totalAmount = extractedData.reduce((sum, item) => sum + (item.data.parsedAmount || 0), 0);

    // Filtered data for the table based on search query
    const filteredExtractedData = useMemo(() => {
        if (!searchQuery) {
            return extractedData;
        }
        const lowerCaseQuery = searchQuery.toLowerCase();
        return extractedData.filter(item => {
            // Check all relevant string fields for a match
            return (
                item.imageId?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.senderName?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.recipientName?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.amount?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.transactionDate?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.transactionTime?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.transactionId?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.senderBankName?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.senderBankAccountNumber?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.recipientBankName?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.recipientBankAccountNumber?.toLowerCase().includes(lowerCaseQuery) ||
                item.data.country?.toLowerCase().includes(lowerCaseQuery)
            );
        });
    }, [extractedData, searchQuery]);


    // Calculate daily frequency data for the graph and sort by frequency (descending)
    const dailyFrequencyData = useMemo(() => {
        const frequencyMap = {};
        extractedData.forEach(item => {
            const date = item.data.transactionDate;
            if (date) {
                frequencyMap[date] = (frequencyMap[date] || 0) + 1;
            }
        });

        const dataArray = Object.keys(frequencyMap).map(date => ({
            date: date,
            count: frequencyMap[date]
        }));

        dataArray.sort((a, b) => b.count - a.count);

        return dataArray;
    }, [extractedData]);

    // Calculate Top 5 Most Frequently Transferred To Accounts (Recipient) by Count and Amount and Bank Name
    const topRecipientAccountsData = useMemo(() => {
        const accountStatsMap = {}; // { accountNumber: { count: number, totalAmount: number, bankName: string } }

        extractedData.forEach(item => {
            // Aggregate recipient accounts
            if (item.data.recipientBankAccountNumber) {
                const acc = item.data.recipientBankAccountNumber;
                const amount = item.data.parsedAmount || 0;
                const bank = item.data.recipientBankName || ''; // Use recipientBankName

                if (!accountStatsMap[acc]) {
                    accountStatsMap[acc] = { count: 0, totalAmount: 0, bankName: bank }; // Store bank name
                }
                accountStatsMap[acc].count += 1; // Increment count
                accountStatsMap[acc].totalAmount += amount; // Add to total amount
                // If bank name is already set, keep the first one encountered or handle conflict as needed
                // For simplicity, we'll keep the first one. If it's empty, try to set it.
                if (!accountStatsMap[acc].bankName && bank) {
                    accountStatsMap[acc].bankName = bank;
                }
            }
        });

        // Convert map to array, sort by transactionCount (frequency), and take top 5
        const sortedAccounts = Object.keys(accountStatsMap)
            .map(accountNumber => ({
                accountNumber,
                transactionCount: accountStatsMap[accountNumber].count,
                totalAmountTransferred: accountStatsMap[accountNumber].totalAmount,
                bankName: accountStatsMap[accountNumber].bankName || '-' // Include bank name
            }))
            .sort((a, b) => b.transactionCount - a.transactionCount) // Sort by frequency (count)
            .slice(0, 5); // Get top 5

        return sortedAccounts;
    }, [extractedData]);

    // Calculate Bank Usage Frequency for Pie Chart
    const bankUsageData = useMemo(() => {
        const bankMap = {}; // { bankName: count }

        extractedData.forEach(item => {
            if (item.data.recipientBankName) { // Use recipientBankName for pie chart
                let bank = item.data.recipientBankName.trim(); // Trim whitespace

                // Normalize bank names: "krungsri bank" to "กรุงศรี", "ธ.กสิกรไทย" or "kasikornbank" to "กสิกรไทย"
                if (bank.toLowerCase().includes("krungsri")) {
                    bank = "กรุงศรี";
                } else if (bank.includes("กสิกร") || bank.toLowerCase().includes("kasikorn")) {
                    bank = "กสิกรไทย";
                } else if (bank.toLowerCase().includes("scb") || bank.includes("ไทยพาณิชย์")) {
                    bank = "ไทยพาณิชย์"; // Add SCB normalization
                }
                // Add more normalization rules here if needed for other banks

                bankMap[bank] = (bankMap[bank] || 0) + 1;
            }
        });

        // Convert map to array and sort by count (descending)
        const sortedBanks = Object.keys(bankMap)
            .map(bankName => ({
                name: bankName,
                value: bankMap[bankName]
            }))
            .sort((a, b) => b.value - a.value);

        return sortedBanks;
    }, [extractedData]);

    // Colors for the pie chart slices: Red, Orange, Yellow, Sky Blue, Green
    const PIE_COLORS = ['#FF0000', '#FFA500', '#FFFF00', '#00BFFF', '#008000'];


    return (
        <div className="min-h-screen relative bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 text-white font-inter overflow-hidden">
            {/* Background Canvas for animation */}
            <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full z-0"></canvas>

            {/* Header */}
            <header className="relative z-10 bg-blue-900 bg-opacity-80 shadow-md py-4">
                <nav className="container mx-auto px-4 flex justify-between items-center">
                    {/* Logo */}
                    <a href="#" className="text-3xl font-extrabold text-yellow-400 hover:text-yellow-300 transition-colors duration-300">
                        AI<span className="text-blue-200">Slip</span>
                    </a>
                    {/* Navigation Menu */}
                    <ul className="flex space-x-6">
                        <li>
                            <a href="#home" className="text-blue-200 hover:text-yellow-400 font-medium transition-colors duration-300">
                                หน้าหลัก
                            </a>
                        </li>
                        <li>
                            <a href="#about" className="text-blue-200 hover:text-yellow-400 font-medium transition-colors duration-300">
                                เกี่ยวกับ
                            </a>
                        </li>
                        <li>
                            <a href="#contact" className="text-blue-200 hover:text-yellow-400 font-medium transition-colors duration-300">
                                ติดต่อ
                            </a>
                        </li>
                    </ul>
                </nav>
            </header>

            <div className="relative z-10 container mx-auto p-4 md:p-8">
                <header className="text-center py-8">
                    <h1 className="text-4xl md:text-5xl font-extrabold text-yellow-400 mb-2">
                        AI Slip Extractor
                    </h1>
                    <p className="text-xl md:text-2xl text-blue-200">
                        ดึงข้อมูลจากสลิปโอนเงินได้อย่างง่ายดาย
                    </p>
                    {isAuthReady && userId && (
                        <p className="text-blue-300 text-sm mt-2">
                            User ID: <span className="font-mono">{userId}</span>
                        </p>
                    )}
                </header>

                <main className="bg-blue-800 bg-opacity-70 backdrop-blur-sm rounded-xl shadow-2xl p-6 md:p-10 max-w-3xl mx-auto my-8 border border-blue-700">
                    <h2 className="text-2xl font-bold text-yellow-300 mb-6 text-center">อัปโหลดสลิปโอนเงินของคุณ</h2>

                    {/* File Upload / Drop Zone */}
                    <div
                        className={`border-2 border-dashed ${isDragOver ? 'border-yellow-400 bg-blue-700' : 'border-blue-500 bg-blue-800 bg-opacity-70'} rounded-lg p-8 text-center cursor-pointer transition-all duration-300 hover:border-yellow-400 hover:bg-blue-700`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onClick={() => document.getElementById('fileInput').click()}
                        onDrop={handleDrop}
                    >
                        <input
                            type="file"
                            id="fileInput"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="hidden"
                            multiple // Allow multiple file selection
                            key={fileInputKey} // Added key to force re-render and reset
                        />
                        {selectedImages.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                                {selectedImages.map((image, index) => (
                                    <div key={image.id} className="relative group"> {/* Use image.id as key */}
                                        <img
                                            src={image.dataUrl}
                                            alt={`Uploaded Slip ${index + 1}`}
                                            className="w-full h-40 object-cover rounded-md shadow-lg"
                                        />
                                        <button
                                            onClick={(e) => { e.stopPropagation(); removeImage(image.id); }}
                                            className="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white rounded-full p-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                                            aria-label={`Remove image ${index + 1}`}
                                        >
                                            <i className="fas fa-times"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-blue-200 text-lg">
                                ลากและวางรูปภาพสลิปที่นี่ หรือ <span className="text-yellow-300 font-semibold">คลิกเพื่อเลือกไฟล์</span>
                            </p>
                        )}
                    </div>

                    {error && (
                        <p className="text-red-400 text-center mt-4 text-lg">{error}</p>
                    )}

                    {/* Process Button */}
                    <button
                        onClick={processSlipWithAI}
                        disabled={selectedImages.length === 0 || loading || !isAuthReady}
                        className="mt-6 w-full bg-yellow-500 hover:bg-yellow-600 text-blue-900 font-bold py-3 px-6 rounded-full shadow-lg transform transition duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {loading ? (
                            <>
                                <i className="fas fa-spinner fa-spin mr-3"></i>
                                กำลังประมวลผล...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-magic mr-3"></i>
                                ดึงข้อมูลสลิป
                            </>
                        )}
                    </button>

                    {/* Dashboard Summary */}
                    {extractedData.length > 0 && (
                        <div className="mt-8 bg-blue-700 p-6 rounded-lg shadow-xl border border-blue-600">
                            <h3 className="text-2xl font-bold text-yellow-300 mb-4 text-center">สรุปข้อมูลสลิป</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                                <div className="bg-blue-800 p-4 rounded-lg shadow-md">
                                    <p className="text-4xl font-bold text-yellow-400">{totalSlips}</p>
                                    <p className="text-blue-200 text-lg">จำนวนสลิปที่ประมวลผล</p>
                                </div>
                                <div className="bg-blue-800 p-4 rounded-lg shadow-md">
                                    <p className="text-4xl font-bold text-yellow-400">฿{totalAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                                    <p className="text-blue-200 text-lg">ยอดรวมทั้งหมด</p>
                                </div>
                            </div>

                            {/* Search Input with Icon */}
                            <div className="mt-8 mb-4 relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <i className="fas fa-search text-blue-300"></i>
                                </div>
                                <input
                                    type="text"
                                    placeholder="ค้นหาข้อมูลในตาราง..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full p-3 pl-10 rounded-lg bg-blue-900 text-blue-100 border border-blue-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                />
                            </div>

                            {/* Extracted Data Table - Moved here, above the chart */}
                            <div className="mt-8 overflow-x-auto bg-blue-700 p-4 rounded-lg shadow-xl border border-blue-600">
                                <table className="min-w-full divide-y divide-blue-600 text-blue-100">
                                    <thead className="bg-blue-800">
                                        <tr>
                                            {/* Moved Image column to the front */}
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider rounded-tl-lg">
                                                รูปภาพ
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                Image ID
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                ชื่อผู้ส่ง
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                ชื่อผู้รับ
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                จำนวนเงิน
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                วันที่ทำรายการ
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                เวลาทำรายการ
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                รหัสอ้างอิง
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                ชื่อธนาคารต้นทาง
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                เลขบัญชีต้นทาง
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider rounded-tr-lg">
                                                ชื่อธนาคารปลายทาง
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider rounded-tr-lg">
                                                เลขบัญชีปลายทาง
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider rounded-tr-lg">
                                                ประเทศ
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-blue-600">
                                        {filteredExtractedData.map((item) => { // Use filteredExtractedData here
                                            const originalImage = selectedImages.find(img => img.id === item.imageId);
                                            return (
                                                <tr key={item.imageId} className="hover:bg-blue-800 transition-colors duration-200">
                                                    {/* Moved Image data cell to the front */}
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                        {originalImage && (
                                                            <img
                                                                src={originalImage.dataUrl}
                                                                alt={`Slip ${item.imageId}`}
                                                                className="w-16 h-16 object-cover rounded-md cursor-pointer mx-auto"
                                                                onClick={() => openImageModal(item.imageId)}
                                                            />
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                        <span
                                                            className="cursor-pointer text-blue-300 hover:text-yellow-300 underline"
                                                            onClick={() => openImageModal(item.imageId)}
                                                        >
                                                            {item.imageId.substring(0, 8)}...
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{item.data.senderName || '-'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{item.data.recipientName || '-'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">฿{parseFloat(item.data.amount?.replace(/[^0-9.-]+/g,"") || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{item.data.transactionDate || '-'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{item.data.transactionTime || '-'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{item.data.transactionId || '-'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{item.data.senderBankName || '-'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{item.data.senderBankAccountNumber || '-'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{item.data.recipientBankName || '-'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{item.data.recipientBankAccountNumber || '-'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">{item.data.country || '-'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Daily Frequency Chart */}
                            {dailyFrequencyData.length > 0 && (
                                <div className="mt-8 bg-blue-800 p-6 rounded-lg shadow-md">
                                    <h4 className="text-xl font-bold text-yellow-300 mb-4 text-center">ความถี่การทำรายการรายวัน</h4>
                                    <ResponsiveContainer width="100%" height={300}>
                                        <BarChart data={dailyFrequencyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                            <XAxis dataKey="date" stroke="#90CDF4" /> {/* Blue-300 */}
                                            <YAxis stroke="#90CDF4" />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#2B6CB0', border: 'none', borderRadius: '8px' }}
                                                labelStyle={{ color: '#F6E05E' }}
                                                itemStyle={{ color: '#E2E8F0' }}
                                            />
                                            <Legend wrapperStyle={{ paddingTop: '10px', color: '#E2E8F0' }} />
                                            <Bar dataKey="count" name="จำนวนสลิป" fill="#F6E05E" barSize={20} radius={[10, 10, 0, 0]} /> {/* Yellow-400 */}
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            {/* Top 5 Most Frequently Transferred To Accounts (Recipient) */}
                            {topRecipientAccountsData.length > 0 && (
                                <div className="mt-8 bg-blue-800 p-6 rounded-lg shadow-md">
                                    <h4 className="text-xl font-bold text-yellow-300 mb-4 text-center">Top 5 บัญชีปลายทางที่ถูกโอนไปบ่อยที่สุด</h4>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-blue-600 text-blue-100">
                                            <thead className="bg-blue-700">
                                                <tr>
                                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider rounded-tl-lg">
                                                        เลขบัญชีปลายทาง
                                                    </th>
                                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                        ชื่อธนาคารปลายทาง
                                                    </th>
                                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider">
                                                        จำนวนครั้ง
                                                    </th>
                                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-yellow-200 uppercase tracking-wider rounded-tr-lg">
                                                        ยอดรวม (฿)
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-blue-600">
                                                {topRecipientAccountsData.map((account, index) => (
                                                    <tr key={index} className="hover:bg-blue-700 transition-colors duration-200">
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                            {account.accountNumber}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                            {account.bankName}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                            {account.transactionCount}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                            ฿{account.totalAmountTransferred.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Bank Usage Pie Chart */}
                            {bankUsageData.length > 0 && (
                                <div className="mt-8 bg-blue-800 p-6 rounded-lg shadow-md">
                                    <h4 className="text-xl font-bold text-yellow-300 mb-4 text-center">ธนาคารปลายทางที่ใช้บ่อยที่สุด</h4>
                                    <ResponsiveContainer width="100%" height={300}>
                                        <PieChart>
                                            <Pie
                                                data={bankUsageData}
                                                cx="50%"
                                                cy="50%"
                                                labelLine={false}
                                                outerRadius={100}
                                                fill="#8884d8"
                                                dataKey="value"
                                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                            >
                                                {bankUsageData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#2B6CB0', border: 'none', borderRadius: '8px' }}
                                                labelStyle={{ color: '#F6E05E' }}
                                                itemStyle={{ color: '#E2E8F0' }}
                                                formatter={(value, name) => [`${value} รายการ`, name]}
                                            />
                                            <Legend wrapperStyle={{ paddingTop: '10px', color: '#E2E8F0' }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            <div className="flex justify-center mt-6 space-x-4">
                                <button
                                    onClick={() => {
                                        setSelectedImages([]);
                                        setExtractedData([]);
                                        setError(null);
                                        setCsvContentForPreview('');
                                        setShowCsvPreview(false);
                                        setFileInputKey(prevKey => prevKey + 1); // Increment key to reset file input
                                        setSearchQuery(''); // Clear search query on reset
                                        // Clear all images from Firestore as well
                                        if (db && userId) {
                                            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
                                            const slipsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/slips`);
                                            // Fetch all docs and delete them
                                            getDocs(slipsCollectionRef).then(snapshot => {
                                                snapshot.forEach(doc => {
                                                    deleteDoc(doc.ref);
                                                });
                                            }).catch(e => {
                                                console.error("Error clearing all images from Firestore:", e);
                                                setError("Failed to clear all images from database.");
                                            });
                                        }
                                    }}
                                    className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-5 rounded-full shadow-lg transform transition duration-300 hover:scale-105"
                                >
                                    <i className="fas fa-redo-alt mr-2"></i> เริ่มใหม่
                                </button>
                                <button
                                    onClick={() => setShowCsvPreview(true)}
                                    className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-5 rounded-full shadow-lg transform transition duration-300 hover:scale-105"
                                >
                                    <i className="fas fa-download mr-2"></i> ดาวน์โหลด CSV
                                </button>
                            </div>
                        </div>
                    )}
                </main>

                <footer className="text-center py-8 text-blue-200 text-sm">
                    <p>&copy; 2025 AI Slip Extractor. สงวนลิขสิทธิ์.</p>
                </footer>
            </div>

            {/* CSV Preview Modal */}
            {showCsvPreview && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                    <div className="bg-blue-800 rounded-xl shadow-2xl p-6 md:p-8 w-full max-w-2xl border border-blue-700">
                        <h3 className="text-2xl font-bold text-yellow-300 mb-4 text-center">ตัวอย่างข้อมูล CSV</h3>
                        <textarea
                            className="w-full h-64 bg-blue-900 text-blue-100 p-4 rounded-lg border border-blue-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            value={csvContentForPreview}
                            readOnly
                        ></textarea>
                        <div className="mt-6 flex justify-end space-x-4">
                            <button
                                onClick={() => setShowCsvPreview(false)}
                                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-5 rounded-full shadow-lg transform transition duration-300 hover:scale-105"
                            >
                                ปิด
                            </button>
                            <button
                                onClick={handleDownloadCsv}
                                className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-5 rounded-full shadow-lg transform transition duration-300 hover:scale-105"
                            >
                                <i className="fas fa-download mr-2"></i> ดาวน์โหลด CSV
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Image Viewer Modal */}
            {showImageModal && currentImageModalUrl && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                    <div className="bg-blue-800 rounded-xl shadow-2xl p-6 md:p-8 w-full max-w-lg border border-blue-700 relative">
                        <button
                            onClick={() => {
                                setShowImageModal(false);
                                setCurrentImageModalUrl(null);
                            }}
                            className="absolute top-4 right-4 bg-red-600 hover:bg-red-700 text-white rounded-full p-2 text-lg shadow-lg transform transition duration-300 hover:scale-110"
                            aria-label="Close image viewer"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                        <h3 className="text-2xl font-bold text-yellow-300 mb-4 text-center">รูปภาพสลิป</h3>
                        <div className="flex justify-center items-center max-h-[50vh] overflow-auto">
                            <img src={currentImageModalUrl} alt="Full size slip" className="max-w-full h-auto rounded-md shadow-lg border border-blue-500" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
