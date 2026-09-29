Definition of Done

`PS C:\Users\uzair\Documents\flyrank-capstone-social-studio> curl.exe -X POST http://localhost:3000/posts/e10b232c-7802-4464-9e31-2c6a94f5b3f3/variants -H "Content-Type: application/json" --data "@requests/bad-variant.json"`
`{"error":{"code":"VARIANT_RULE_VIOLATION","message":"Variant breaks x rules","details":[{"code":"TOO_LONG","message":"x: 300 characters, maximum is280"}]}}`

`
$ curl -i -X POST /variants/<id>/schedule (variant is still draft)
HTTP/1.1 409 Conflict
{"error":{"code":"VARIANT_NOT_APPROVED","message":"Only approved variants can be scheduled (this one is draft)"}}

$ curl -i -X POST /variants/<id>/approve
HTTP/1.1 200 OK
{"variant":{... "status":"approved" ...}}

$ curl -i -X POST /variants/<id>/schedule
HTTP/1.1 201 Created
{"slot":{... "status":"scheduled", "idempotencyKey":"<variantId>:<slotId>" ...},"replayed":false}
`

`
C:\Users\uzair\Documents\flyrank-capstone-social-studio\src\modules\scheduling\publish.ts
1:1 error '../../adapters/discord' import is restricted from being used by a pattern. Business logic may only depend on the SocialPublisher interface no-restricted-imports

✖ 1 problem (1 error, 0 warnings)
`
