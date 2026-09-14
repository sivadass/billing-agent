import { Button, Icon, Typography } from 'cleanplate';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent } from 'react';
import styles from './image-lightbox.module.scss';

export type ImageLightboxProps = {
  src: string;
  alt: string;
  className?: string;
};

export function ImageLightbox({ src, alt, className }: ImageLightboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const open = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    previousFocusRef.current = event.currentTarget;
    setIsOpen(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    closeButtonRef.current?.focus();

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [close, isOpen]);

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      close();
    }
  };

  const overlay = isOpen ? (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={styles.overlay}
      onClick={handleOverlayClick}
    >
      <div className={styles.viewer} onClick={(event) => event.stopPropagation()}>
        <div className={styles.toolbar}>
          <Typography
            id={titleId}
            variant="small"
            margin="0"
            className={styles.caption}
          >
            {alt}
          </Typography>
          <Button
            ref={closeButtonRef}
            variant="icon"
            size="small"
            type="button"
            aria-label="Close"
            onClick={close}
          >
            <Icon name="close" />
          </Button>
        </div>
        <img src={src} alt={alt} className={styles['full-image']} />
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className={`${styles['thumbnail-button']} ${className ?? ''}`.trim()}
        onClick={open}
        aria-label={`View ${alt} full size`}
      >
        <img src={src} alt="" className={styles.thumbnail} loading="lazy" />
      </button>

      {overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}
