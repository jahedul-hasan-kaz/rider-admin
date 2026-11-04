"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Modals open as a drawer from the right (placement "drawer", the default): full height, the header and the action bar
 * stay in place while the fields scroll. Use placement "center" for small prompts (command palette).
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  placement = "drawer",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  placement?: "drawer" | "center"
}) {
  const drawer = placement === "drawer"
  return (
    <DialogPortal>
      <DialogOverlay className={drawer ? "bg-black/25 backdrop-blur-[3px] supports-backdrop-filter:backdrop-blur-[3px]" : undefined} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-placement={placement}
        className={cn(
          "group/dialog z-50 bg-popover text-sm text-popover-foreground outline-none",
          drawer
            ? [
                // Three rows: header and footer stay put, only the body (DialogBody) scrolls.
                "fixed inset-y-0 right-0 flex h-dvh w-full flex-col overflow-hidden border-l shadow-2xl sm:max-w-md sm:rounded-l-2xl",
                "data-open:animate-in data-open:slide-in-from-right data-open:duration-300 data-open:ease-out",
                "data-closed:animate-out data-closed:slide-out-to-right data-closed:duration-200",
                "[&>form]:flex [&>form]:min-h-0 [&>form]:flex-1 [&>form]:flex-col",
              ]
            : "fixed top-1/2 left-1/2 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl p-4 ring-1 ring-foreground/10 duration-100 sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className={cn("absolute", drawer ? "top-3 right-3 z-20 rounded-full" : "top-2 right-2")}
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-col gap-2",
        "group-data-[placement=drawer]/dialog:shrink-0 group-data-[placement=drawer]/dialog:border-b group-data-[placement=drawer]/dialog:bg-gradient-to-b group-data-[placement=drawer]/dialog:from-primary/10 group-data-[placement=drawer]/dialog:to-transparent group-data-[placement=drawer]/dialog:px-5 group-data-[placement=drawer]/dialog:py-4 group-data-[placement=drawer]/dialog:pr-12 sm:group-data-[placement=drawer]/dialog:px-6",
        "group-data-[placement=drawer]/dialog:[&_[data-slot=dialog-title]]:text-lg group-data-[placement=drawer]/dialog:[&_[data-slot=dialog-title]]:font-semibold",
        className
      )}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        // In a drawer the action bar is the last fixed row.
        "group-data-[placement=drawer]/dialog:m-0 group-data-[placement=drawer]/dialog:shrink-0 group-data-[placement=drawer]/dialog:rounded-none group-data-[placement=drawer]/dialog:bg-popover group-data-[placement=drawer]/dialog:px-5 group-data-[placement=drawer]/dialog:py-3 group-data-[placement=drawer]/dialog:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:group-data-[placement=drawer]/dialog:px-6",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

/** The scrolling middle of a drawer (fields, lists). */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "space-y-5 group-data-[placement=drawer]/dialog:min-h-0 group-data-[placement=drawer]/dialog:flex-1 group-data-[placement=drawer]/dialog:overflow-y-auto group-data-[placement=drawer]/dialog:overscroll-contain group-data-[placement=drawer]/dialog:px-5 group-data-[placement=drawer]/dialog:py-5 sm:group-data-[placement=drawer]/dialog:px-6",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
