Definition of Done



`
$ curl -i -X POST /variants/<id>/schedule        (variant is still draft)
HTTP/1.1 409 Conflict
{"error":{"code":"VARIANT_NOT_APPROVED","message":"Only approved variants can be scheduled (this one is draft)"}}

$ curl -i -X POST /variants/<id>/approve
HTTP/1.1 200 OK
{"variant":{... "status":"approved" ...}}

$ curl -i -X POST /variants/<id>/schedule
HTTP/1.1 201 Created
{"slot":{... "status":"scheduled", "idempotencyKey":"<variantId>:<slotId>" ...},"replayed":false}
`