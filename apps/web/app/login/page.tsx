"use client";
import React, { useState } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import { GoogleLogin } from '@react-oauth/google';

export default function LoginPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const onSuccess = async (credentialResponse: any) => {
        setLoading(true);
        try {
            const res = await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/auth/google`, {
                token: credentialResponse.credential
            });
            localStorage.setItem('user', JSON.stringify(res.data));
            router.push('/dashboard');
        } catch (error) {
            console.error(error);
            alert('Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="max-w-md w-full space-y-8 p-10 bg-white rounded-xl shadow-lg">
                <div className="text-center">
                    <h2 className="mt-6 text-3xl font-extrabold text-gray-900">Email Scheduler</h2>
                    <p className="mt-2 text-sm text-gray-600">Sign in to manage your campaigns</p>
                </div>
                <div className="flex justify-center mt-8">
                    <GoogleLogin
                        onSuccess={onSuccess}
                        onError={() => {
                            console.log('Login Failed');
                            alert('Google Login Failed');
                        }}
                        useOneTap={false}
                    />
                </div>
                {loading && <p className="text-center text-sm text-gray-500 mt-4">Logging in...</p>}
            </div>
        </div>
    );
}
