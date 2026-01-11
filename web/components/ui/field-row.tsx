"use client"

import * as React from "react"
import { useId } from "react"
import { Field, FieldLabel, FieldControl } from "@/components/ui/field"

export function FieldRow({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: React.InputHTMLAttributes<HTMLInputElement>["type"]
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldControl
        id={id}
        type={type}
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </Field>
  )
}
