// motion-bits — deljeni animacijski gradniki (Framer Motion)
// Micro-animacije za prehode, hover, tap, vstop v viewport.

'use client'

import { motion, AnimatePresence, type HTMLMotionProps } from 'framer-motion'
import type { ReactNode } from 'react'

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
}

export const slideUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: 'easeOut' as const },
}

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: 0.2, ease: 'easeOut' as const },
}

export function FadeIn ({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, delay }}
    >
      {children}
    </motion.div>
  )
}

export function SlideUp ({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerChildren ({ children, stagger = 0.05 }: { children: ReactNode; stagger?: number }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: stagger } },
      }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem ({ children }: { children: ReactNode }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
      }}
    >
      {children}
    </motion.div>
  )
}

export { motion, AnimatePresence }

// Card hover animation — profesionalen hover efekt
export function CardHover ({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// List animation — staggered entrance for list items
// a11y: ul/li → motion.div izgubi semantiko seznama — role=list/listitem jo vrne (bralniki zaslona)
export function AnimatedList ({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <motion.div
      role="list"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.04 } },
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}

export function AnimatedListItem ({ children, className, ...rest }: { children: ReactNode; className?: string } & Omit<HTMLMotionProps<'div'>, 'children' | 'className'>) {
  return (
    <motion.div
      role="listitem"
      variants={{
        hidden: { opacity: 0, x: -8 },
        visible: { opacity: 1, x: 0, transition: { duration: 0.2 } },
      }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
