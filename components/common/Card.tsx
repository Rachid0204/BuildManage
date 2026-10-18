
import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    // FIX: Add onClick prop to allow the card to be clickable.
    onClick?: () => void;
}

const Card: React.FC<CardProps> = ({ children, className = '', onClick }) => {
    return (
        <div className={`bg-white rounded-lg shadow-md p-6 ${className}`} onClick={onClick}>
            {children}
        </div>
    );
};

export default Card;
