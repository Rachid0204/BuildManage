import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { getUserNotifications, markNotificationAsRead } from '../../firebase/services';
import { useI18n } from '../../hooks/useI18n';

const NotificationBell: React.FC = () => {
  const { userProfile } = useAuth();
  const { t, isAr } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', userProfile?.uid],
    queryFn: () => (userProfile?.uid ? getUserNotifications(userProfile.uid) : []),
    enabled: !!userProfile?.uid,
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: markNotificationAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userProfile?.uid] });
    },
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

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
    notifications.forEach((n) => {
      if (!n.read) markReadMutation.mutate(n.id);
    });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100/80 focus:outline-none min-w-[40px] min-h-[40px] flex items-center justify-center"
        aria-label={t('header.notifications')}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1.5 end-1.5 block h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
        )}
      </button>

      {isOpen && (
        <div className="fixed sm:absolute inset-x-3 sm:inset-x-auto sm:end-0 top-16 sm:top-auto sm:mt-2 w-auto sm:w-80 bg-white rounded-xl shadow-xl overflow-hidden z-50 border border-slate-200 text-slate-900">
          <div className="py-2">
            <div className="px-4 py-2.5 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                {t('header.notifications')}
              </h3>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="text-xs font-semibold text-teal-700 hover:text-teal-900"
                >
                  {t('header.markAllRead')}
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {notifications.length > 0 ? (
                notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors ${
                      notification.read ? 'opacity-65' : 'bg-teal-50/40'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <p className="text-xs font-bold text-slate-900">{notification.title}</p>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {new Date(notification.createdAt).toLocaleDateString(
                          isAr ? 'ar-MA' : 'fr-MA'
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      {notification.message}
                    </p>
                  </div>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-xs text-slate-500">
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
