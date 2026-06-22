import { redirect } from "next/navigation";

// The book is the whole app now — there is no separate "today" page. The root
// lands the reader straight in the calendar (today's capture lives in the
// fill zone at the foot of the book).
export default function Home() {
  redirect("/calendar");
}
