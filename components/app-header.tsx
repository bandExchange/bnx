"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

type AppHeaderProps = {
  showFeedButton?: boolean;
  showBackButton?: boolean;
  title?: string;
  className?: string;
};

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 6L9 12L15 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeaderLogo({ linked }: { linked: boolean }) {
  const logo = <span className="header__logo" aria-hidden={!linked} />;

  if (linked) {
    return (
      <Link href="/" className="header__brand" aria-label="BNX 홈">
        {logo}
      </Link>
    );
  }

  return <span className="header__brand header__brand--static">{logo}</span>;
}

export default function AppHeader({
  showFeedButton = false,
  showBackButton = false,
  title,
  className = "",
}: AppHeaderProps) {
  const router = useRouter();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  return (
    <header className={`header ${className}`.trim()}>
      <div
        className={`header__inner${
          showBackButton ? " header__inner--community" : " header__inner--home"
        }`}
      >
        {showBackButton ? (
          <>
            <button
              type="button"
              className="header__back"
              onClick={handleBack}
              aria-label="뒤로 가기"
            >
              <BackIcon />
            </button>
            <HeaderLogo linked={false} />
            {title && <h1 className="header__title">{title}</h1>}
          </>
        ) : (
          <>
            <div className="header__spacer" aria-hidden="true" />
            <HeaderLogo linked />
            {showFeedButton && (
              <Link
                href="/community"
                className="header__feed-btn"
                aria-label="커뮤니티로 이동"
              >
                <Image src="/feed.png" alt="" width={18} height={18} aria-hidden />
              </Link>
            )}
          </>
        )}
      </div>
    </header>
  );
}
