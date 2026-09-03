import { PageHeader, type PageBreadcrumb } from '@/components/shared/page-header';

interface DetailPageHeaderProps {
  breadcrumbs: PageBreadcrumb[];
  title: React.ReactNode;
  subtitle?: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}

/** Detail-page header: `PageHeader` with breadcrumbs (kept as a named alias for existing call sites). */
export function DetailPageHeader(props: DetailPageHeaderProps) {
  return <PageHeader {...props} />;
}
