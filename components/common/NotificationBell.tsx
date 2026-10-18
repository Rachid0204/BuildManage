import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { getUserNotifications, markNotificationAsRead } from '../../firebase/services';
import { useI18n } from '../../hooks/useI18n';

const NotificationBell: React.FC = () => {
    const { userProfile } = useAuth();
    const { t } = useI18n();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const { data: notifications = [] } = useQuery({
        queryKey: ['notifications', userProfile?.uid],
        queryFn: () => userProfile?.uid ? getUserNotifications(userProfile.uid) : [],
        enabled: !!userProfile?.uid,
        refetchInterval: 30000 // Poll every 30s
    });

    const markReadMutation = useMutation({
        mutationFn: markNotificationAsRead,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['notifications', userProfile?.uid] });
        }
    });

    const unreadCount = notifications.filter(n => !n.read).length;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleNotificationClick = (notification: any) => {
        if (!notification.read) {
            markReadMutation.mutate(notification.id);
        }
        setIsOpen(false);
        if (notification.link && userProfile?.role === 'syndic') {
            navigate(notification.link);
        }
    };

    const markAllAsRead = () => {
        notifications.forEach(n => {
            if (!n.read) markReadMutation.mutate(n.id);
        });
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 text-gray-400 hover:text-gray-500 focus:outline-none"
                aria-label={t('header.notifications')}
            >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 block h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white"></span>
                )}
            </button>

            {isOpen && (
                <div className="fixed sm:absolute inset-x-3 sm:inset-x-auto sm:right-0 top-16 sm:top-auto sm:mt-2 w-auto sm:w-80 bg-white rounded-xl shadow-xl overflow-hidden z-50 ring-1 ring-black ring-opacity-5">
                    <div className="py-2">
                        <div className="px-4 py-2.5 border-b border-gray-100 flex justify-between items-center">
                            <h3 className="text-sm font-semibold text-gray-700">{t('header.notifications')}</h3>
                            {unreadCount > 0 && (
                                <button 
                                    onClick={markAllAsRead}
                                    className="text-xs text-primary-600 hover:text-primary-800"
                                >
                                    {t('header.markAllRead')}
                                </button>
                            )}
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                            {notifications.length > 0 ? (
                                notifications.map((notification) => (
                                    <div 
                                        key={notification.id}
                                        onClick={() => handleNotificationClick(notification)}
                                        className={`px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0 ${notification.read ? 'opacity-60' : 'bg-blue-50'}`}
                                    >
                                        <div className="flex justify-between items-start">
                                            <p className="text-sm font-medium text-gray-900">{notification.title}</p>
                                            <span className="text-xs text-gray-400">{new Date(notification.createdAt).toLocaleDateString()}</span>
                                        </div>
                                        <p className="text-sm text-gray-500 mt-1">{notification.message}</p>
                                    </div>
                                ))
                            ) : (
                                <div className="px-4 py-6 text-center text-sm text-gray-500">
                                    {t('header.noNotifications')}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
