import Link from 'next/link';
import { Logo } from '@/components/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4">
      <header className="flex h-[72px] w-full max-w-[1240px] items-center">
        <Link href="/" aria-label="My Trading View home"><Logo /></Link>
      </header>
      <main className="flex w-full flex-1 items-start justify-center pt-10">{children}</main>
    </div>
  );
}
