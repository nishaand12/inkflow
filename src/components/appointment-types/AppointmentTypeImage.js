import React, { useState, useEffect } from "react";

export default function AppointmentTypeImage({ imageUrl, alt = "", className = "" }) {
  const [hasError, setHasError] = useState(false);
  const trimmedUrl = imageUrl?.trim() || "";

  useEffect(() => {
    setHasError(false);
  }, [trimmedUrl]);

  if (!trimmedUrl || hasError) {
    return null;
  }

  return (
    <img
      src={trimmedUrl}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setHasError(true)}
    />
  );
}
