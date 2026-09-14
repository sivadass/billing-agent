import { BreadCrumb } from 'cleanplate';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

export type PageBreadcrumbItem = {
  label: string;
  href?: string;
};

type PageBreadcrumbProps = {
  items: PageBreadcrumbItem[];
};

function isModifiedClick(event: MouseEvent) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function PageBreadcrumb({ items }: PageBreadcrumbProps) {
  const navigate = useNavigate();

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isModifiedClick(event) || event.defaultPrevented) return;
    const target = (event.target as HTMLElement | null)?.closest('a');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('mailto:')) return;
    event.preventDefault();
    navigate(href);
  };

  return (
    <div onClick={onClick}>
      <BreadCrumb items={items} margin="b-3" />
    </div>
  );
}
