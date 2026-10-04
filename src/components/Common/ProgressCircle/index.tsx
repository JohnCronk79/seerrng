import { memo, useMemo } from 'react';

interface ProgressCircleProps {
  className?: string;
  progress?: number;
  useHeatLevel?: boolean;
}

const radius = 10;
const circumference = radius * 2 * Math.PI;

const ProgressCircle = memo(
  ({ className, progress = 0, useHeatLevel }: ProgressCircleProps) => {
    const { color, emptyColor } = useMemo(() => {
      if (!useHeatLevel) {
        return { color: '', emptyColor: 'text-gray-300' };
      }

      if (progress === 0) {
        return { color: 'text-red-500', emptyColor: 'text-red-600' };
      }

      if (progress <= 10) {
        return { color: 'text-red-500', emptyColor: 'text-gray-300' };
      }

      if (progress <= 50) {
        return { color: 'text-yellow-500', emptyColor: 'text-gray-300' };
      }

      return { color: 'text-green-500', emptyColor: 'text-gray-300' };
    }, [progress, useHeatLevel]);

    const offset = useMemo(
      () => circumference - (progress / 100) * circumference,
      [progress]
    );

    return (
      <svg className={`${className} ${color}`} viewBox="0 0 24 24">
        <circle
          className={`${emptyColor} opacity-30`}
          stroke="currentColor"
          strokeWidth="3"
          fill="transparent"
          r={radius}
          cx="12"
          cy="12"
        />
        <circle
          style={{
            strokeDasharray: `${circumference} ${circumference}`,
            strokeDashoffset: offset,
            transition: '0.35s stroke-dashoffset',
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%',
          }}
          stroke="currentColor"
          strokeWidth="3"
          fill="transparent"
          r={radius}
          cx="12"
          cy="12"
        />
      </svg>
    );
  }
);

ProgressCircle.displayName = 'ProgressCircle';

export default ProgressCircle;
