import React, { useRef, useState } from 'react';
import { notifyOperation } from '../../utils/formFeedback';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary' | 'accent' | 'danger' | 'light';
    icon?: React.ReactNode;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
    children,
    variant = 'primary',
    icon,
    leftIcon,
    rightIcon,
    className = '',
    onClick,
    disabled,
    ...props
}) => {
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
        if (pending.current) return;
        pending.current = true;
        try {
            const result = onClick?.(event) as unknown;
            if (result && typeof (result as Promise<unknown>).then === 'function') {
                setBusy(true);
                await result;
            }
        } catch (error) {
            notifyOperation({ operation: 'action', error: error instanceof Error ? error.message : 'Opération impossible.' });
        } finally { pending.current = false; setBusy(false); }
    };
    const baseClasses = 'inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed';
    
    const variantClasses = {
        primary: 'text-white bg-primary-700 hover:bg-primary-800 focus:ring-primary-500',
        secondary: 'text-primary-800 bg-primary-100 hover:bg-primary-200 focus:ring-primary-500',
        accent: 'text-white bg-accent-600 hover:bg-accent-700 focus:ring-accent-500',
        danger: 'text-white bg-red-600 hover:bg-red-700 focus:ring-red-500',
        light: 'text-primary-900 bg-white hover:bg-primary-50 border-white/80 focus:ring-white',
    };

    const resolvedLeftIcon = icon ?? leftIcon;

    return (
        <button
            type="button"
            className={`${baseClasses} ${variantClasses[variant]} ${className}`}
            {...props}
            onClick={onClick ? handleClick : undefined}
            disabled={disabled || busy}
            aria-busy={busy || props['aria-busy']}
        >
            {busy && <span aria-hidden="true" className="me-2 h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            {resolvedLeftIcon && <span className="me-2 -ms-1 h-5 w-5 flex items-center justify-center">{resolvedLeftIcon}</span>}
            {children}
            {rightIcon && <span className="ms-2 -me-1 h-5 w-5 flex items-center justify-center">{rightIcon}</span>}
        </button>
    );
};

export default Button;
