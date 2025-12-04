'use client'

import { User } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useUserProfile } from '@/components/user/user-profile-context'
import { Skeleton } from '@/components/ui/skeleton'

function ProfileCardSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton className="size-9 rounded-full" />
      <div className="flex-1 min-w-0">
        <Skeleton className="h-4 w-24 mb-1" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  )
}

export function SidebarProfileCard() {
  const { profile, isLoading: profileLoading } = useUserProfile()

  if (profileLoading || !profile) {
    return <ProfileCardSkeleton />
  }

  const fullName = `${profile.firstName} ${profile.lastName}`

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg cursor-default">
      {/* Avatar - left side */}
      <Avatar className="size-9 shrink-0">
        <AvatarFallback className="bg-muted text-muted-foreground">
          <User className="size-4" />
        </AvatarFallback>
      </Avatar>

      {/* User info - right side */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-foreground">
          {fullName}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {profile.email}
        </p>
      </div>
    </div>
  )
}

