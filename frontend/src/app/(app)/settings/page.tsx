import Link from 'next/link';

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[420px] text-center">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">
        Settings
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Profile settings arrive in a later epic.{' '}
        <Link
          className="text-primary underline-offset-4 hover:underline"
          href="/settings/security"
        >
          Security
        </Link>
      </p>
    </div>
  );
}
