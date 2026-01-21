"use client";
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import axios from 'axios';
import { Upload, Clock, AlertCircle } from 'lucide-react';

export default function SchedulePage() {
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [parsedEmails, setParsedEmails] = useState<any[]>([]);
    const [scheduledTime, setScheduledTime] = useState('');
    const [loading, setLoading] = useState(false);
    const [minDelay, setMinDelay] = useState(2000);
    const [hourlyLimit, setHourlyLimit] = useState(200);

    // Drag & Drop
    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.toLowerCase().trim(), // Normalize headers
            complete: (results) => {
                const headers = results.meta.fields || [];
                const valid = results.data.filter((row: any) => row.email);

                if (valid.length === 0) {
                    alert(`No valid emails found.\n\nDetected Headers: ${headers.join(', ') || 'None'}\n\nEnsure your CSV has a column named 'email'.`);
                    console.log('Parsed Results:', results);
                }
                setParsedEmails(valid);
            }
        });
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'text/csv': ['.csv'],
            'application/vnd.ms-excel': ['.csv'],
            'text/plain': ['.csv']
        }
    });

    const handleSchedule = async () => {
        const userStr = localStorage.getItem('user');
        if (!userStr) return;
        const user = JSON.parse(userStr);

        if (parsedEmails.length === 0 && !body) {
            alert("Please provide emails via CSV");
            return;
        }

        setLoading(true);

        // Prepare payload
        // If CSV has subject/body, use them. If not, use global form subject/body.
        const emails = parsedEmails.map((row: any) => ({
            recipient: row.email,
            subject: row.subject || subject,
            body: row.body || body,
        }));

        try {
            await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/schedule`, {
                userId: user.id || user.googleId || 'demo-user-id',
                emails,
                scheduledTime: scheduledTime ? new Date(scheduledTime).toISOString() : null,
                minDelay: Number(minDelay),
                hourlyLimit: Number(hourlyLimit)
            });
            alert(`Successfully scheduled ${emails.length} emails!`);
            // Reset
            setParsedEmails([]);
            setSubject('');
            setBody('');
            setScheduledTime('');
        } catch (error) {
            console.error(error);
            alert('Failed to schedule emails.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Compose & Schedule</h2>

            <div className="bg-white p-6 rounded-lg shadow space-y-4">
                {/* Subject & Body */}
                <div>
                    <label className="block text-sm font-medium text-gray-700">Default Subject</label>
                    <input
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
                        placeholder="Check out our new feature!"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Default Body</label>
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={4}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
                        placeholder="Hi there..."
                    />
                </div>

                {/* CSV Upload */}
                <div {...getRootProps()} className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${isDragActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-gray-400'}`}>
                    <input {...getInputProps()} />
                    <Upload className="mx-auto h-12 w-12 text-gray-400" />
                    <p className="mt-2 text-sm text-gray-600">Drag & drop CSV here, or click to select</p>
                    <p className="text-xs text-gray-500 mt-1">Found {parsedEmails.length} emails</p>
                </div>

                {parsedEmails.length > 0 && (
                    <div className="text-sm text-green-600 bg-green-50 p-2 rounded">
                        Ready to send to {parsedEmails.length} recipients.
                    </div>
                )}

                {/* Scheduling Config */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Schedule Time</label>
                        <input
                            type="datetime-local"
                            value={scheduledTime}
                            onChange={(e) => setScheduledTime(e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-gray-900"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Min Delay (ms)</label>
                        <input
                            type="number"
                            value={minDelay}
                            onChange={(e) => setMinDelay(Number(e.target.value))}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-gray-900"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Emails Per Hour</label>
                        <input
                            type="number"
                            value={hourlyLimit}
                            onChange={(e) => setHourlyLimit(Number(e.target.value))}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-gray-900"
                        />
                    </div>
                </div>

                <button
                    onClick={handleSchedule}
                    disabled={loading || parsedEmails.length === 0}
                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                    {loading ? 'Scheduling...' : 'Schedule Campaign'}
                </button>
            </div>
        </div>
    );
}
