import React from 'react';

// This component has been retired as part of the Cacti rebrand.
// Kept as a minimal stub so stale imports don't break the build.
interface ProposalCardProps {
  proposal: any;
  onModify: () => void;
  modifyCount: number;
}

export function ProposalCard({ proposal, onModify, modifyCount }: ProposalCardProps) {
  return null;
}