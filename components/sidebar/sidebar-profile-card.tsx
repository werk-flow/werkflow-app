'use client'

import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Settings, User } from 'lucide-react'
import { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useUserProfile } from '@/components/user/user-profile-context'
import { useSignOut } from '@/hooks/use-sign-out'
import { cn } from '@/lib/utils'

function ProfileCardSkeleton() {
  return (
    <div className="mx-2 my-2">
      <div className="flex items-center gap-3 rounded-lg p-3">
        <Skeleton className="size-9 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-1 h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    </div>
  )
}

export function SidebarProfileCard() {
  const { profile, isLoading: profileLoading } = useUserProfile()
  const pathname = usePathname()
  const router = useRouter()
  const { isSigningOut, signOut } = useSignOut()
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  if (profileLoading || !profile) {
    return <ProfileCardSkeleton />
  }

  const fullName = `${profile.firstName} ${profile.lastName}`.trim() || 'Benutzerkonto'
  const initials = `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`.trim()
  const isSettingsRoute =
    pathname === '/einstellungen' || pathname.startsWith('/einstellungen/')
  const isActive = isSettingsRoute || isMenuOpen

  return (
    <div className="mx-2 my-2">
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-lg p-3 text-left transition-colors outline-none',
              isActive ? 'bg-accent/60 hover:bg-accent/70' : 'hover:bg-accent/70',
              'focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0'
            )}
            aria-label="Kontomenü öffnen"
          >
            <Avatar className="size-9 shrink-0">
              {profile.avatarUrl ? (
                <AvatarImage
                  src={profile.avatarUrl}
                  alt={`Profilbild von ${fullName}`}
                />
              ) : null}
              <AvatarFallback className="bg-muted text-[11px] leading-none font-semibold text-muted-foreground">
                {initials || <User className="size-3.5" />}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {fullName}
              </p>
              <p className="truncate text-xs leading-5 text-muted-foreground">
                {profile.email}
              </p>
            </div>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          alignOffset={8}
          side="top"
          sideOffset={8}
          className="w-56"
        >
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate font-medium">{fullName}</span>
            <span className="truncate text-xs leading-5 font-normal text-muted-foreground">
              {profile.email}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setIsMenuOpen(false)
              router.push('/einstellungen')
            }}
            className="cursor-pointer"
          >
            <Settings className="size-4" />
            Einstellungen
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              setIsMenuOpen(false)
              void signOut()
            }}
            disabled={isSigningOut}
            variant="destructive"
            className="cursor-pointer"
          >
            <LogOut className="size-4" />
            {isSigningOut ? 'Abmeldung läuft...' : 'Abmelden'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

