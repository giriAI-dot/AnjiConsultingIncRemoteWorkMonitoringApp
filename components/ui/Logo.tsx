import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg 
      viewBox="0 0 320 80" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
      aria-label="Anji Consulting Inc Logo"
    >
      <defs>
        <linearGradient id="logoGradient" x1="0" y1="0" x2="60" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F97316" />
            <stop offset="100%" stopColor="#EA580C" />
        </linearGradient>
      </defs>

      {/* Icon Group: Tech Hexagon */}
      <g transform="translate(10, 10)">
         {/* Main Hexagon Shape */}
         <path 
            d="M30 2 L56 17 V47 L30 62 L4 47 V17 Z" 
            stroke="url(#logoGradient)" 
            strokeWidth="3" 
            strokeLinejoin="round"
            fill="rgba(249, 115, 22, 0.1)"
         />
         
         {/* Abstract 'A' / Circuit Structure */}
         <path 
            d="M30 15 V34 M30 34 L18 44 M30 34 L42 44" 
            stroke="#F97316" 
            strokeWidth="3" 
            strokeLinecap="round"
            strokeLinejoin="round"
         />
         {/* Central Node */}
         <circle cx="30" cy="34" r="3" fill="white"/>
      </g>

      {/* Typography */}
      <g transform="translate(80, 0)">
          {/* ANJI - Large, Heavy Bold */}
          <text y="48" x="0" fill="white" fontSize="40" fontWeight="800" fontFamily="sans-serif" letterSpacing="-0.02em">ANJI</text>
          
          {/* CONSULTING INC - Spaced out below */}
          <text y="70" x="2" fill="#9CA3AF" fontSize="12" fontWeight="600" fontFamily="sans-serif" letterSpacing="0.25em">CONSULTING INC</text>
      </g>
    </svg>
  );
};