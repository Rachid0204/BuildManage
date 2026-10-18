import React from 'react';

const Loading: React.FC<{ message?: string }> = ({ message }) => {
    return (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-white bg-opacity-80 z-50 backdrop-blur-sm">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mb-4"></div>
            {message && <p className="text-primary-700 font-medium animate-pulse">{message}</p>}
        </div>
    );
};

export default Loading;