import type { Metadata } from "next";
import CommunityPage from "@/components/community-page";

export const metadata: Metadata = {
  title: "커뮤니티",
};

export default function CommunityRoute() {
  return <CommunityPage />;
}
