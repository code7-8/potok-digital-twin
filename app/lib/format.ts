/** Minute zero is 08:00 on the first day; imported models can span up to a week. */
export function timeLabel(minutes:number):string {
  const total=480+Math.max(0,Math.floor(minutes));
  const day=Math.floor(total/1440),clock=`${String(Math.floor(total/60)%24).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
  return day?`${clock} (+${day} д.)`:clock;
}
