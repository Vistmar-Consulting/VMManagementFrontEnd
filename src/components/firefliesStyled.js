// Small styled primitives shared by PastMeetingsCard + MeetingDetailModal.
// Ported from Console archive Agenda.jsx (ShimmerBar 213-226, MiniPill 356-368).
// Kept as Emotion styled() because the shimmer keyframe animation is awkward
// to express via MUI sx.

import styled from "@emotion/styled";
import { keyframes } from "@emotion/react";
import { t } from "../theme/tokens.js";

const shimmer = keyframes`
  0% { background-position: -400px 0; }
  100% { background-position: 400px 0; }
`;

export const ShimmerBar = styled.div`
  height: ${(p) => p.$h || 14}px;
  width: ${(p) => p.$w || "100%"};
  border-radius: 6px;
  margin-bottom: ${(p) => p.$mb || 8}px;
  background: linear-gradient(90deg, ${t.cream2} 25%, ${t.cream3} 37%, ${t.cream2} 63%);
  background-size: 800px 100%;
  animation: ${shimmer} 1.4s ease infinite;
`;

export const MiniPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  background: ${(p) => p.$bg || "#f0f0f0"};
  color: ${(p) => p.$color || t.ink3};
`;
